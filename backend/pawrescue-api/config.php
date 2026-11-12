<?php
declare(strict_types=1);

const DB_HOST = '127.0.0.1';
const DB_NAME = 'petrescue_db';
const DB_USER = 'root';
const DB_PASS = '';

function database(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ],
    );
    return $pdo;
}

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function request_data(): array
{
    $decoded = json_decode(file_get_contents('php://input') ?: '', true);
    if (!is_array($decoded)) {
        respond(400, ['error' => 'Invalid JSON body.']);
    }
    return $decoded;
}

function current_user(PDO $pdo, bool $required = true): ?array
{
    $header = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    if (!preg_match('/^Bearer ([A-Fa-f0-9]{64})$/', $header, $match)) {
        if ($required) {
            respond(401, ['error' => 'Please sign in to continue.']);
        }
        return null;
    }

    $statement = $pdo->prepare(
        'SELECT u.id, u.full_name, u.email, u.role
         FROM auth_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.expires_at > NOW()',
    );
    $statement->execute([hash('sha256', $match[1])]);
    $user = $statement->fetch();
    if (!$user && $required) {
        respond(401, ['error' => 'Your session expired. Please sign in again.']);
    }
    if ($user) {
        $user['id'] = (string) $user['id'];
        $user['fullName'] = $user['full_name'];
        unset($user['full_name']);
    }
    return $user ?: null;
}

function require_admin(array $user): void
{
    if ($user['role'] !== 'admin') {
        respond(403, ['error' => 'Admin access is required for this action.']);
    }
}

function create_token(PDO $pdo, int $userId): string
{
    $token = bin2hex(random_bytes(32));
    $statement = $pdo->prepare(
        'INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 30 DAY))',
    );
    $statement->execute([$userId, hash('sha256', $token)]);
    return $token;
}

function animal_record(array $row): array
{
    return [
        'id' => (string) $row['id'],
        'reportedBy' => $row['reporter_name'],
        'animalType' => $row['animal_type'],
        'photoUrl' => $row['photo_url'] ?? '',
        'address' => $row['address'],
        'latitude' => $row['latitude'] === null ? null : (float) $row['latitude'],
        'longitude' => $row['longitude'] === null ? null : (float) $row['longitude'],
        'conditionNotes' => $row['condition_notes'],
        'medicalNotes' => $row['medical_notes'] ?? '',
        'status' => $row['status'],
        'name' => $row['name'],
        'age' => $row['age'] === null ? null : (int) $row['age'],
        'gender' => $row['gender'],
        'createdAt' => date(DATE_ATOM, strtotime($row['created_at'])),
    ];
}

function adoption_record(array $row): array
{
    return [
        'id' => (string) $row['id'],
        'animalId' => (string) $row['animal_id'],
        'userId' => (string) $row['user_id'],
        'applicantName' => $row['applicant_name'],
        'contactNumber' => $row['contact_number'],
        'homeDetails' => $row['home_details'],
        'reason' => $row['reason'],
        'requestStatus' => $row['request_status'],
        'submittedAt' => date(DATE_ATOM, strtotime($row['submitted_at'])),
        'animalName' => $row['animal_name'],
        'animalPhoto' => $row['animal_photo'] ?? '',
    ];
}
