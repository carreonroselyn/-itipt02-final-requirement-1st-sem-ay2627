from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pymysql
from fastapi import Body, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pymysql.cursors import DictCursor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("pawrescue")

ROOT = Path(__file__).resolve().parent
UPLOAD_DIR = ROOT / "backend" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PawRescue API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:4200",
        "http://127.0.0.1:4200",
        "http://localhost:8100",
        "http://127.0.0.1:8100",
        "http://localhost",
        "capacitor://localhost",
        "http://localhost:5173",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

ANIMAL_STATUSES = {
    "Pending Rescue",
    "Rescued / In Transit",
    "In Treatment",
    "Healed & Ready",
    "Reserved for Pickup",
}
ANIMAL_TRANSITIONS = {
    "Pending Rescue": {"Rescued / In Transit"},
    "Rescued / In Transit": {"In Treatment"},
    "In Treatment": {"Healed & Ready"},
    "Healed & Ready": set(),
    "Reserved for Pickup": set(),
}
ANIMAL_TYPES = {"Dog", "Cat", "Other"}
GENDERS = {"Male", "Female", "Unknown"}
PHOTO_PATTERN = re.compile(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$")


def database_connection():
    try:
        return pymysql.connect(
            host=os.getenv("DB_HOST", "127.0.0.1"),
            port=int(os.getenv("DB_PORT", "3306")),
            user=os.getenv("DB_USER", "root"),
            password=os.getenv("DB_PASS", ""),
            database=os.getenv("DB_NAME", "petrescue_db"),
            charset="utf8mb4",
            cursorclass=DictCursor,
            autocommit=False,
            connect_timeout=5,
        )
    except pymysql.MySQLError as error:
        logger.exception("Could not connect to MySQL database petrescue_db")
        raise HTTPException(
            status_code=503,
            detail=(
                "Hindi makakonekta sa MySQL database na petrescue_db. "
                "I-start ang MySQL sa XAMPP at i-import ang backend/petrescue_db.sql."
            ),
        ) from error


def fail(status: int, message: str) -> None:
    raise HTTPException(status_code=status, detail=message)


def require_text(data: dict[str, Any], key: str, label: str, maximum: int | None = None) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        fail(422, f"{label} is required.")
    value = value.strip()
    if maximum is not None and len(value) > maximum:
        fail(422, f"{label} must be {maximum} characters or fewer.")
    return value


def user_record(row: dict[str, Any]) -> dict[str, str]:
    return {
        "id": str(row["id"]),
        "fullName": row["full_name"],
        "email": row["email"],
        "role": row["role"],
    }


def animal_record(row: dict[str, Any]) -> dict[str, Any]:
    created_at = row["created_at"]
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return {
        "id": str(row["id"]),
        "reportedBy": row["reporter_name"],
        "reportedById": str(row["reported_by"]),
        "animalType": row["animal_type"],
        "photoUrl": row["photo_url"] or "",
        "address": row["address"],
        "latitude": float(row["latitude"]) if row["latitude"] is not None else None,
        "longitude": float(row["longitude"]) if row["longitude"] is not None else None,
        "conditionNotes": row["condition_notes"],
        "medicalNotes": row["medical_notes"] or "",
        "status": row["status"],
        "name": row["name"],
        "age": int(row["age"]) if row["age"] is not None else None,
        "gender": row["gender"],
        "createdAt": created_at.isoformat(),
    }


def adoption_record(row: dict[str, Any]) -> dict[str, Any]:
    submitted_at = row["submitted_at"]
    if submitted_at.tzinfo is None:
        submitted_at = submitted_at.replace(tzinfo=timezone.utc)
    return {
        "id": str(row["id"]),
        "animalId": str(row["animal_id"]),
        "userId": str(row["user_id"]),
        "applicantName": row["applicant_name"],
        "contactNumber": row["contact_number"],
        "homeDetails": row["home_details"],
        "reason": row["reason"],
        "requestStatus": row["request_status"],
        "submittedAt": submitted_at.isoformat(),
        "animalName": row["animal_name"],
        "animalPhoto": row["animal_photo"] or "",
    }


def report_history_record(row: dict[str, Any]) -> dict[str, Any]:
    created_at = row["created_at"]
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return {
        "id": str(row["id"]),
        "animalId": str(row["animal_id"]),
        "reportedBy": row["reporter_name"],
        "animalName": row["animal_name"],
        "eventType": row["event_type"],
        "status": row["status"],
        "createdAt": created_at.isoformat(),
    }


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return f"pbkdf2_sha256${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, salt_hex, digest_hex = stored_hash.split("$", 2)
        if algorithm != "pbkdf2_sha256":
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), 310_000)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def create_token(cursor: Any, user_id: int) -> str:
    token = secrets.token_hex(32)
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)
    cursor.execute(
        "INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
        (user_id, token_hash, expires_at),
    )
    return token


def current_user(cursor: Any, authorization: str | None, required: bool = True) -> dict[str, Any] | None:
    if not authorization:
        if required:
            fail(401, "Please sign in to continue.")
        return None
    scheme, separator, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not separator or not re.fullmatch(r"[a-fA-F0-9]{64}", token):
        fail(401, "Invalid sign-in token.")
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    cursor.execute(
        """SELECT u.id, u.full_name, u.email, u.role
           FROM auth_tokens t
           JOIN users u ON u.id = t.user_id
           WHERE t.token_hash = %s AND t.expires_at > UTC_TIMESTAMP()""",
        (token_hash,),
    )
    user = cursor.fetchone()
    if not user:
        fail(401, "Your session expired. Please sign in again.")
    return user


def require_admin(user: dict[str, Any]) -> None:
    if user["role"] != "admin":
        fail(403, "Admin access is required for this action.")


def save_photo(data_url: Any) -> str | None:
    if data_url is None or data_url == "":
        return None
    if not isinstance(data_url, str) or len(data_url) > 3_600_000:
        fail(422, "Photo must be a JPEG, PNG, or WebP image under 2.5 MB.")
    match = PHOTO_PATTERN.fullmatch(data_url)
    if not match:
        fail(422, "Photo must be a JPEG, PNG, or WebP image under 2.5 MB.")
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except (ValueError, binascii.Error):
        fail(422, "The uploaded photo is not valid base64 data.")
    if len(content) > 2_500_000:
        fail(422, "Photo must be under 2.5 MB.")
    extension = "jpg" if match.group(1) == "jpeg" else match.group(1)
    signatures = {
        "jpg": content.startswith(b"\xff\xd8\xff"),
        "png": content.startswith(b"\x89PNG\r\n\x1a\n"),
        "webp": len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP",
    }
    if not signatures[extension]:
        fail(422, "The uploaded file is not a valid supported image.")
    filename = f"{secrets.token_hex(16)}.{extension}"
    (UPLOAD_DIR / filename).write_bytes(content)
    return f"http://localhost:8000/uploads/{filename}"


def as_optional_float(value: Any, label: str, minimum: float, maximum: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        fail(422, f"{label} must be a number.")
    if not minimum <= number <= maximum:
        fail(422, f"{label} is out of range.")
    return number


@app.get("/health")
def health() -> dict[str, str]:
    connection = database_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT DATABASE() AS database_name")
            database_name = cursor.fetchone()["database_name"]
        return {"status": "ok", "database": database_name}
    finally:
        connection.close()


@app.get("/")
@app.post("/")
@app.patch("/")
@app.delete("/")
def api(
    request: Request,
    action: str = Query(...),
    payload: dict[str, Any] = Body(default={}),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    connection = database_connection()
    try:
        with connection.cursor() as cursor:
            if action == "register" and request.method == "POST":
                name = require_text(payload, "fullName", "Full name", 120)
                email = require_text(payload, "email", "Email", 190).lower()
                password = require_text(payload, "password", "Password")
                if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
                    fail(422, "Enter a valid email address.")
                if len(password) < 8:
                    fail(422, "Password must be at least 8 characters.")
                try:
                    cursor.execute(
                        "INSERT INTO users (full_name, email, password_hash) VALUES (%s, %s, %s)",
                        (name, email, hash_password(password)),
                    )
                except pymysql.err.IntegrityError as error:
                    if error.args and error.args[0] == 1062:
                        fail(409, "An account with this email already exists.")
                    raise
                user_id = cursor.lastrowid
                user = {"id": str(user_id), "fullName": name, "email": email, "role": "user"}
                token = create_token(cursor, user_id)
                connection.commit()
                return {"data": {"token": token, "user": user}}

            if action == "login" and request.method == "POST":
                email = require_text(payload, "email", "Email").lower()
                password = require_text(payload, "password", "Password")
                cursor.execute(
                    "SELECT id, full_name, email, password_hash, role FROM users WHERE email = %s",
                    (email,),
                )
                user = cursor.fetchone()
                if not user or not verify_password(password, user["password_hash"]):
                    fail(401, "Email or password is incorrect.")
                token = create_token(cursor, user["id"])
                connection.commit()
                return {"data": {"token": token, "user": user_record(user)}}

            if action == "health" and request.method == "GET":
                cursor.execute("SELECT DATABASE() AS database_name")
                return {"data": {"status": "ok", "database": cursor.fetchone()["database_name"]}}

            if action == "me" and request.method == "GET":
                user = current_user(cursor, authorization)
                return {"data": user_record(user)}

            if action == "password" and request.method == "PATCH":
                user = current_user(cursor, authorization)
                current_password = require_text(payload, "currentPassword", "Current password")
                new_password = require_text(payload, "newPassword", "New password")
                if len(new_password) < 8:
                    fail(422, "New password must be at least 8 characters.")
                cursor.execute(
                    "SELECT password_hash FROM users WHERE id = %s FOR UPDATE",
                    (user["id"],),
                )
                account = cursor.fetchone()
                if not account or not verify_password(current_password, account["password_hash"]):
                    fail(401, "Current password is incorrect.")
                cursor.execute(
                    "UPDATE users SET password_hash = %s WHERE id = %s",
                    (hash_password(new_password), user["id"]),
                )
                cursor.execute("DELETE FROM auth_tokens WHERE user_id = %s", (user["id"],))
                token = create_token(cursor, user["id"])
                connection.commit()
                return {"data": {"token": token, "updated": True}}

            if action == "animals" and request.method == "GET":
                viewer = current_user(cursor, authorization, required=False)
                query = """SELECT a.*, u.full_name AS reporter_name
                           FROM animals a JOIN users u ON u.id = a.reported_by"""
                if viewer and viewer["role"] == "admin":
                    cursor.execute(query + " ORDER BY a.created_at DESC")
                elif viewer:
                    cursor.execute(
                        query
                        + " WHERE a.status = 'Healed & Ready' OR a.reported_by = %s"
                        + " ORDER BY a.created_at DESC",
                        (viewer["id"],),
                    )
                else:
                    cursor.execute(
                        query + " WHERE a.status = 'Healed & Ready' ORDER BY a.created_at DESC"
                    )
                return {"data": [animal_record(row) for row in cursor.fetchall()]}

            if action == "adoptions" and request.method == "GET":
                user = current_user(cursor, authorization)
                query = """SELECT r.*, a.name AS animal_name, a.photo_url AS animal_photo
                           FROM adoptions r JOIN animals a ON a.id = r.animal_id"""
                if user["role"] == "admin":
                    cursor.execute(query + " ORDER BY r.submitted_at DESC")
                else:
                    cursor.execute(
                        query + " WHERE r.user_id = %s ORDER BY r.submitted_at DESC",
                        (user["id"],),
                    )
                return {"data": [adoption_record(row) for row in cursor.fetchall()]}

            if action == "animals" and request.method == "POST":
                user = current_user(cursor, authorization)
                animal_type = payload.get("animalType")
                if animal_type not in ANIMAL_TYPES:
                    fail(422, "Animal type must be Dog, Cat, or Other.")
                address = require_text(payload, "address", "Location", 255)
                condition = require_text(payload, "conditionNotes", "Condition notes")
                name = "New rescue" if animal_type == "Other" else f"New {animal_type.lower()} rescue"
                photo_url = save_photo(payload.get("photoUrl"))
                cursor.execute(
                    """INSERT INTO animals
                       (reported_by, animal_type, photo_url, address, latitude, longitude,
                        condition_notes, medical_notes, name, age, gender)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, '', %s, NULL, 'Unknown')""",
                    (
                        user["id"],
                        animal_type,
                        photo_url,
                        address,
                        as_optional_float(payload.get("latitude"), "Latitude", -90, 90),
                        as_optional_float(payload.get("longitude"), "Longitude", -180, 180),
                        condition,
                        name,
                    ),
                )
                animal_id = cursor.lastrowid
                cursor.execute(
                    """INSERT INTO rescue_report_history
                       (animal_id, changed_by, event_type, status)
                       VALUES (%s, %s, 'submitted', 'Pending Rescue')""",
                    (animal_id, user["id"]),
                )
                connection.commit()
                return {"data": {"id": str(animal_id)}}

            if action == "report-history" and request.method == "GET":
                user = current_user(cursor, authorization)
                query = """SELECT h.id, h.animal_id, h.event_type, h.status, h.created_at,
                                  u.full_name AS reporter_name, a.name AS animal_name
                           FROM rescue_report_history h
                           JOIN animals a ON a.id = h.animal_id
                           JOIN users u ON u.id = a.reported_by"""
                if user["role"] == "admin":
                    cursor.execute(query + " ORDER BY h.created_at DESC, h.id DESC")
                else:
                    cursor.execute(
                        query + " WHERE a.reported_by = %s ORDER BY h.created_at DESC, h.id DESC",
                        (user["id"],),
                    )
                return {"data": [report_history_record(row) for row in cursor.fetchall()]}

            animal_match = re.fullmatch(r"animals/(\d+)", action)
            if animal_match and request.method == "DELETE":
                user = current_user(cursor, authorization)
                require_admin(user)
                animal_id = int(animal_match.group(1))
                cursor.execute("SELECT id FROM animals WHERE id = %s FOR UPDATE", (animal_id,))
                if not cursor.fetchone():
                    fail(404, "Animal report not found.")
                cursor.execute(
                    "SELECT 1 FROM adoptions WHERE animal_id = %s LIMIT 1",
                    (animal_id,),
                )
                if cursor.fetchone():
                    fail(409, "Animal reports with adoption history cannot be deleted.")
                cursor.execute("DELETE FROM animals WHERE id = %s", (animal_id,))
                connection.commit()
                return {"data": {"deleted": True}}

            if animal_match and request.method == "PATCH":
                user = current_user(cursor, authorization)
                require_admin(user)
                animal_id = int(animal_match.group(1))
                cursor.execute("SELECT status FROM animals WHERE id = %s FOR UPDATE", (animal_id,))
                animal = cursor.fetchone()
                if not animal:
                    fail(404, "Animal report not found.")
                updates: list[str] = []
                values: list[Any] = []
                if "status" in payload:
                    next_status = payload["status"]
                    if next_status not in ANIMAL_STATUSES:
                        fail(422, "Invalid animal status.")
                    if next_status not in ANIMAL_TRANSITIONS[animal["status"]]:
                        fail(409, "This status transition is not allowed. Refresh and try again.")
                    updates.append("status = %s")
                    values.append(next_status)
                if "medicalNotes" in payload:
                    updates.append("medical_notes = %s")
                    values.append(str(payload["medicalNotes"]).strip())
                if "name" in payload:
                    updates.append("name = %s")
                    values.append(require_text(payload, "name", "Pet name", 120))
                if "age" in payload:
                    age = payload["age"]
                    if age == "":
                        age = None
                    if age is not None and (not isinstance(age, int) or isinstance(age, bool) or not 0 <= age <= 100):
                        fail(422, "Age must be a whole number between 0 and 100.")
                    updates.append("age = %s")
                    values.append(age)
                if "gender" in payload:
                    gender = payload["gender"]
                    if gender not in GENDERS:
                        fail(422, "Gender must be Male, Female, or Unknown.")
                    updates.append("gender = %s")
                    values.append(gender)
                if not updates:
                    fail(422, "No supported animal fields were provided.")
                values.append(animal_id)
                cursor.execute(
                    f"UPDATE animals SET {', '.join(updates)} WHERE id = %s",
                    values,
                )
                if "status" in payload:
                    cursor.execute(
                        """INSERT INTO rescue_report_history
                           (animal_id, changed_by, event_type, status)
                           VALUES (%s, %s, 'status_changed', %s)""",
                        (animal_id, user["id"], next_status),
                    )
                connection.commit()
                return {"data": {"updated": True}}

            if action == "adoptions" and request.method == "POST":
                user = current_user(cursor, authorization)
                animal_id = payload.get("animalId")
                if not isinstance(animal_id, str) or not animal_id.isdigit():
                    fail(422, "Invalid animal ID.")
                contact = require_text(payload, "contactNumber", "Contact number", 32)
                home = require_text(payload, "homeDetails", "Home details")
                reason = require_text(payload, "reason", "Adoption reason")
                cursor.execute("SELECT id, name, status FROM animals WHERE id = %s FOR UPDATE", (animal_id,))
                animal = cursor.fetchone()
                if not animal or animal["status"] != "Healed & Ready":
                    fail(409, "This pet is no longer available for adoption.")
                cursor.execute(
                    """SELECT id FROM adoptions
                       WHERE animal_id = %s AND user_id = %s AND request_status = 'Pending'""",
                    (animal_id, user["id"]),
                )
                if cursor.fetchone():
                    fail(409, "You already have a pending request for this pet.")
                cursor.execute(
                    """INSERT INTO adoptions
                       (animal_id, user_id, applicant_name, contact_number, home_details, reason)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (animal_id, user["id"], user["full_name"], contact, home, reason),
                )
                adoption_id = cursor.lastrowid
                connection.commit()
                return {"data": {"id": str(adoption_id), "animalName": animal["name"]}}

            adoption_match = re.fullmatch(r"adoptions/(\d+)", action)
            if adoption_match and request.method == "PATCH":
                user = current_user(cursor, authorization)
                require_admin(user)
                status = payload.get("requestStatus")
                if status not in {"Approved", "Declined"}:
                    fail(422, "Request status must be Approved or Declined.")
                adoption_id = int(adoption_match.group(1))
                cursor.execute("SELECT animal_id FROM adoptions WHERE id = %s", (adoption_id,))
                adoption = cursor.fetchone()
                if not adoption:
                    fail(404, "Adoption request not found.")
                animal_id = adoption["animal_id"]
                cursor.execute("SELECT status FROM animals WHERE id = %s FOR UPDATE", (animal_id,))
                animal = cursor.fetchone()
                cursor.execute(
                    "SELECT request_status FROM adoptions WHERE id = %s FOR UPDATE",
                    (adoption_id,),
                )
                request = cursor.fetchone()
                if not request or request["request_status"] != "Pending":
                    fail(409, "This adoption request has already been reviewed.")
                if status == "Approved":
                    if not animal or animal["status"] != "Healed & Ready":
                        fail(409, "This pet is not available for reservation.")
                    cursor.execute(
                        "UPDATE animals SET status = 'Reserved for Pickup' WHERE id = %s",
                        (animal_id,),
                    )
                    cursor.execute(
                        """UPDATE adoptions SET request_status = 'Declined'
                           WHERE animal_id = %s AND id <> %s AND request_status = 'Pending'""",
                        (animal_id, adoption_id),
                    )
                cursor.execute(
                    "UPDATE adoptions SET request_status = %s WHERE id = %s",
                    (status, adoption_id),
                )
                connection.commit()
                return {"data": {"updated": True}}

            fail(404, "API route not found.")
    except HTTPException:
        connection.rollback()
        raise
    except pymysql.MySQLError as error:
        connection.rollback()
        logger.exception("PawRescue database request failed")
        if error.args and error.args[0] == 1146:
            raise HTTPException(
                status_code=503,
                detail="Database schema is missing a required table. Re-import backend/petrescue_db.sql in phpMyAdmin.",
            ) from error
        raise HTTPException(status_code=500, detail="Database request failed. Check the API log.") from error
    finally:
        connection.close()
