CREATE DATABASE IF NOT EXISTS petrescue_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE petrescue_db;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  phone VARCHAR(32) NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auth_tokens_hash (token_hash),
  KEY idx_auth_tokens_user (user_id),
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS animals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reported_by BIGINT UNSIGNED NOT NULL,
  animal_type ENUM('Dog', 'Cat', 'Other') NOT NULL,
  photo_url VARCHAR(500) NULL,
  address VARCHAR(255) NOT NULL,
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  condition_notes TEXT NOT NULL,
  medical_notes TEXT NULL,
  status ENUM('Pending Rescue', 'Rescued / In Transit', 'In Treatment', 'Healed & Ready', 'Reserved for Pickup')
    NOT NULL DEFAULT 'Pending Rescue',
  name VARCHAR(120) NOT NULL,
  age SMALLINT UNSIGNED NULL,
  gender ENUM('Male', 'Female', 'Unknown') NOT NULL DEFAULT 'Unknown',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_animals_status_created (status, created_at),
  KEY idx_animals_reported_by (reported_by),
  CONSTRAINT fk_animals_reporter FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rescue_report_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  animal_id BIGINT UNSIGNED NOT NULL,
  changed_by BIGINT UNSIGNED NOT NULL,
  event_type ENUM('submitted', 'status_changed') NOT NULL,
  status ENUM('Pending Rescue', 'Rescued / In Transit', 'In Treatment', 'Healed & Ready', 'Reserved for Pickup')
    NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_report_history_animal_created (animal_id, created_at),
  KEY idx_report_history_actor (changed_by),
  CONSTRAINT fk_report_history_animal FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE CASCADE,
  CONSTRAINT fk_report_history_actor FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS adoptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  animal_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  applicant_name VARCHAR(120) NOT NULL,
  contact_number VARCHAR(32) NOT NULL,
  home_details TEXT NOT NULL,
  reason TEXT NOT NULL,
  request_status ENUM('Pending', 'Approved', 'Declined') NOT NULL DEFAULT 'Pending',
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adoptions_animal_status (animal_id, request_status),
  KEY idx_adoptions_user_submitted (user_id, submitted_at),
  CONSTRAINT fk_adoptions_animal FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE RESTRICT,
  CONSTRAINT fk_adoptions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Register an account through the app first, then grant it admin access in phpMyAdmin:
-- UPDATE users SET role = 'admin' WHERE email = 'your-admin@email.com';
