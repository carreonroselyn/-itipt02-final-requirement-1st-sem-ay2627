<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $pdo = database();
    $method = $_SERVER['REQUEST_METHOD'];
    $action = trim((string) ($_GET['action'] ?? ''), '/');

    if ($method === 'POST' && $action === 'register') {
        $data = request_data();
        $name = trim((string) ($data['fullName'] ?? ''));
        $email = strtolower(trim((string) ($data['email'] ?? '')));
        $password = (string) ($data['password'] ?? '');
        if ($name === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 8) {
            respond(422, ['error' => 'Enter your name, a valid email, and a password of at least 8 characters.']);
        }
        $insert = $pdo->prepare('INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)');
        try {
            $insert->execute([$name, $email, password_hash($password, PASSWORD_DEFAULT)]);
        } catch (PDOException $error) {
            if ($error->getCode() === '23000') {
                respond(409, ['error' => 'An account with this email already exists.']);
            }
            throw $error;
        }
        $userId = (int) $pdo->lastInsertId();
        respond(201, ['data' => [
            'token' => create_token($pdo, $userId),
            'user' => ['id' => (string) $userId, 'fullName' => $name, 'email' => $email, 'role' => 'user'],
        ]]);
    }

    if ($method === 'POST' && $action === 'login') {
        $data = request_data();
        $statement = $pdo->prepare('SELECT id, full_name, email, password_hash, role FROM users WHERE email = ?');
        $statement->execute([strtolower(trim((string) ($data['email'] ?? '')))]);
        $user = $statement->fetch();
        if (!$user || !password_verify((string) ($data['password'] ?? ''), $user['password_hash'])) {
            respond(401, ['error' => 'Email or password is incorrect.']);
        }
        respond(200, ['data' => [
            'token' => create_token($pdo, (int) $user['id']),
            'user' => [
                'id' => (string) $user['id'],
                'fullName' => $user['full_name'],
                'email' => $user['email'],
                'role' => $user['role'],
            ],
        ]]);
    }

    if ($method === 'GET' && $action === 'animals') {
        $viewer = current_user($pdo, false);
        $sql = 'SELECT a.*, u.full_name AS reporter_name
                FROM animals a JOIN users u ON u.id = a.reported_by';
        if ($viewer && $viewer['role'] === 'admin') {
            $query = $pdo->query($sql . ' ORDER BY a.created_at DESC');
        } elseif ($viewer) {
            $query = $pdo->prepare(
                $sql . ' WHERE a.status = \'Healed & Ready\' OR a.reported_by = ? ORDER BY a.created_at DESC',
            );
            $query->execute([$viewer['id']]);
        } else {
            $query = $pdo->query($sql . ' WHERE a.status = \'Healed & Ready\' ORDER BY a.created_at DESC');
        }
        respond(200, ['data' => array_map('animal_record', $query->fetchAll())]);
    }

    if ($method === 'GET' && $action === 'adoptions') {
        $user = current_user($pdo);
        $sql = 'SELECT r.*, a.name AS animal_name, a.photo_url AS animal_photo
                FROM adoptions r JOIN animals a ON a.id = r.animal_id';
        if ($user['role'] === 'admin') {
            $statement = $pdo->query($sql . ' ORDER BY r.submitted_at DESC');
        } else {
            $statement = $pdo->prepare($sql . ' WHERE r.user_id = ? ORDER BY r.submitted_at DESC');
            $statement->execute([$user['id']]);
        }
        respond(200, ['data' => array_map('adoption_record', $statement->fetchAll())]);
    }

    if ($method === 'POST' && $action === 'animals') {
        $user = current_user($pdo);
        $data = request_data();
        $type = $data['animalType'] ?? '';
        $address = trim((string) ($data['address'] ?? ''));
        $notes = trim((string) ($data['conditionNotes'] ?? ''));
        if (!in_array($type, ['Dog', 'Cat', 'Other'], true) || $address === '' || $notes === '') {
            respond(422, ['error' => 'Animal type, location and condition notes are required.']);
        }
        $photoUrl = save_photo((string) ($data['photoUrl'] ?? ''));
        $statement = $pdo->prepare(
            'INSERT INTO animals
             (reported_by, animal_type, photo_url, address, latitude, longitude, condition_notes, medical_notes, name, age, gender)
             VALUES (?, ?, ?, ?, ?, ?, ?, \'\', ?, NULL, \'Unknown\')',
        );
        $statement->execute([
            $user['id'],
            $type,
            $photoUrl,
            $address,
            nullable_number($data['latitude'] ?? null),
            nullable_number($data['longitude'] ?? null),
            $notes,
            $type === 'Other' ? 'New rescue' : 'New ' . strtolower($type) . ' rescue',
        ]);
        respond(201, ['data' => ['id' => (string) $pdo->lastInsertId()]]);
    }

    if ($method === 'PATCH' && preg_match('#^animals/(\d+)$#', $action, $match)) {
        $user = current_user($pdo);
        require_admin($user);
        $data = request_data();
        $id = (int) $match[1];
        $statement = $pdo->prepare('SELECT status FROM animals WHERE id = ?');
        $statement->execute([$id]);
        $animal = $statement->fetch();
        if (!$animal) {
            respond(404, ['error' => 'Animal report not found.']);
        }
        $allowedTransitions = [
            'Pending Rescue' => ['Rescued / In Transit'],
            'Rescued / In Transit' => ['In Treatment'],
            'In Treatment' => ['Healed & Ready'],
            'Healed & Ready' => [],
            'Reserved for Pickup' => [],
        ];
        $sets = [];
        $values = [];
        if (isset($data['status'])) {
            $next = (string) $data['status'];
            if (!in_array($next, $allowedTransitions[$animal['status']], true)) {
                respond(409, ['error' => 'This status transition is not allowed. Refresh and try again.']);
            }
            $sets[] = 'status = ?';
            $values[] = $next;
        }
        if (array_key_exists('medicalNotes', $data)) {
            $sets[] = 'medical_notes = ?';
            $values[] = trim((string) $data['medicalNotes']);
        }
        if (array_key_exists('name', $data)) {
            $name = trim((string) $data['name']);
            if ($name === '' || strlen($name) > 120) {
                respond(422, ['error' => 'Pet name must be between 1 and 120 characters.']);
            }
            $sets[] = 'name = ?';
            $values[] = $name;
        }
        if (array_key_exists('age', $data)) {
            $age = $data['age'] === null || $data['age'] === '' ? null : filter_var($data['age'], FILTER_VALIDATE_INT);
            if ($age !== null && ($age === false || $age < 0 || $age > 100)) {
                respond(422, ['error' => 'Age must be a whole number between 0 and 100.']);
            }
            $sets[] = 'age = ?';
            $values[] = $age;
        }
        if (array_key_exists('gender', $data)) {
            if (!in_array($data['gender'], ['Male', 'Female', 'Unknown'], true)) {
                respond(422, ['error' => 'Gender must be Male, Female, or Unknown.']);
            }
            $sets[] = 'gender = ?';
            $values[] = $data['gender'];
        }
        if (!$sets) {
            respond(422, ['error' => 'No supported animal fields were provided.']);
        }
        $values[] = $id;
        $pdo->prepare('UPDATE animals SET ' . implode(', ', $sets) . ' WHERE id = ?')->execute($values);
        respond(200, ['data' => ['updated' => true]]);
    }

    if ($method === 'DELETE' && preg_match('#^animals/(\d+)$#', $action, $match)) {
        $user = current_user($pdo);
        require_admin($user);
        $id = (int) $match[1];
        $pdo->beginTransaction();
        $animalQuery = $pdo->prepare('SELECT id FROM animals WHERE id = ? FOR UPDATE');
        $animalQuery->execute([$id]);
        if (!$animalQuery->fetch()) {
            $pdo->rollBack();
            respond(404, ['error' => 'Animal report not found.']);
        }
        $adoptionQuery = $pdo->prepare('SELECT 1 FROM adoptions WHERE animal_id = ? LIMIT 1');
        $adoptionQuery->execute([$id]);
        if ($adoptionQuery->fetch()) {
            $pdo->rollBack();
            respond(409, ['error' => 'Animal reports with adoption history cannot be deleted.']);
        }
        $pdo->prepare('DELETE FROM animals WHERE id = ?')->execute([$id]);
        $pdo->commit();
        respond(200, ['data' => ['deleted' => true]]);
    }

    if ($method === 'POST' && $action === 'adoptions') {
        $user = current_user($pdo);
        $data = request_data();
        $animalId = filter_var($data['animalId'] ?? null, FILTER_VALIDATE_INT);
        $contact = trim((string) ($data['contactNumber'] ?? ''));
        $home = trim((string) ($data['homeDetails'] ?? ''));
        $reason = trim((string) ($data['reason'] ?? ''));
        if (!$animalId || $contact === '' || $home === '' || $reason === '') {
            respond(422, ['error' => 'Complete all adoption screening fields.']);
        }
        $pdo->beginTransaction();
        $animalQuery = $pdo->prepare('SELECT name, status FROM animals WHERE id = ? FOR UPDATE');
        $animalQuery->execute([$animalId]);
        $animal = $animalQuery->fetch();
        if (!$animal || $animal['status'] !== 'Healed & Ready') {
            $pdo->rollBack();
            respond(409, ['error' => 'This pet is no longer available for adoption.']);
        }
        $duplicate = $pdo->prepare(
            'SELECT id FROM adoptions WHERE animal_id = ? AND user_id = ? AND request_status = \'Pending\'',
        );
        $duplicate->execute([$animalId, $user['id']]);
        if ($duplicate->fetch()) {
            $pdo->rollBack();
            respond(409, ['error' => 'You already have a pending request for this pet.']);
        }
        $insert = $pdo->prepare(
            'INSERT INTO adoptions (animal_id, user_id, applicant_name, contact_number, home_details, reason)
             VALUES (?, ?, ?, ?, ?, ?)',
        );
        $insert->execute([$animalId, $user['id'], $user['fullName'], $contact, $home, $reason]);
        $pdo->commit();
        respond(201, ['data' => ['id' => (string) $pdo->lastInsertId(), 'animalName' => $animal['name']]]);
    }

    if ($method === 'PATCH' && preg_match('#^adoptions/(\d+)$#', $action, $match)) {
        $user = current_user($pdo);
        require_admin($user);
        $data = request_data();
        $status = $data['requestStatus'] ?? '';
        if (!in_array($status, ['Approved', 'Declined'], true)) {
            respond(422, ['error' => 'Request status must be Approved or Declined.']);
        }
        $pdo->beginTransaction();
        $query = $pdo->prepare('SELECT animal_id, request_status FROM adoptions WHERE id = ? FOR UPDATE');
        $query->execute([(int) $match[1]]);
        $request = $query->fetch();
        if (!$request || $request['request_status'] !== 'Pending') {
            $pdo->rollBack();
            respond(409, ['error' => 'This adoption request has already been reviewed.']);
        }
        if ($status === 'Approved') {
            $animalQuery = $pdo->prepare('SELECT status FROM animals WHERE id = ? FOR UPDATE');
            $animalQuery->execute([$request['animal_id']]);
            if ($animalQuery->fetchColumn() !== 'Healed & Ready') {
                $pdo->rollBack();
                respond(409, ['error' => 'This pet is not available for reservation.']);
            }
            $pdo->prepare('UPDATE animals SET status = \'Reserved for Pickup\' WHERE id = ?')
                ->execute([$request['animal_id']]);
            $pdo->prepare(
                'UPDATE adoptions SET request_status = \'Declined\' WHERE animal_id = ? AND id <> ? AND request_status = \'Pending\'',
            )->execute([$request['animal_id'], (int) $match[1]]);
        }
        $pdo->prepare('UPDATE adoptions SET request_status = ? WHERE id = ?')
            ->execute([$status, (int) $match[1]]);
        $pdo->commit();
        respond(200, ['data' => ['updated' => true]]);
    }

    respond(404, ['error' => 'API route not found.']);
} catch (Throwable $error) {
    error_log($error->__toString());
    respond(500, ['error' => 'The server could not complete this request. Check the PHP error log.']);
}

function nullable_number(mixed $value): ?float
{
    if ($value === null || $value === '') {
        return null;
    }
    return is_numeric($value) ? (float) $value : null;
}

function save_photo(string $value): ?string
{
    if ($value === '') {
        return null;
    }
    if (strlen($value) > 3_600_000 || !preg_match('#^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$#', $value, $match)) {
        respond(422, ['error' => 'Photo must be a JPEG, PNG or WebP image under 2.5 MB.']);
    }
    $contents = base64_decode($match[2], true);
    if ($contents === false || strlen($contents) > 2_500_000) {
        respond(422, ['error' => 'Photo must be under 2.5 MB.']);
    }
    $image = getimagesizefromstring($contents);
    if ($image === false || !in_array($image['mime'], ['image/jpeg', 'image/png', 'image/webp'], true)) {
        respond(422, ['error' => 'The uploaded file is not a valid supported image.']);
    }
    $extension = $match[1] === 'jpeg' ? 'jpg' : $match[1];
    $directory = __DIR__ . '/uploads';
    if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
        respond(500, ['error' => 'Could not create the photo upload directory.']);
    }
    $filename = bin2hex(random_bytes(16)) . '.' . $extension;
    if (file_put_contents($directory . '/' . $filename, $contents, LOCK_EX) === false) {
        respond(500, ['error' => 'Could not save the uploaded photo.']);
    }
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/pawrescue-api/index.php')), '/');
    return 'http://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . $base . '/uploads/' . $filename;
}
