CREATE DATABASE IF NOT EXISTS face_recognition_db;
USE face_recognition_db;

CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    metadata TEXT,
    face_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS verification_log (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(50) NULL,
    device_id VARCHAR(100) NULL,
    distance DECIMAL(10, 6) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_verification_user (user_id),
    INDEX idx_verification_time (created_at)
);
