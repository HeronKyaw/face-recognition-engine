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
    success BOOLEAN NOT NULL DEFAULT TRUE,
    reason VARCHAR(255) NULL,
    log_type VARCHAR(20) NOT NULL DEFAULT 'verification',
    method VARCHAR(20) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_verification_user (user_id),
    INDEX idx_verification_time (created_at),
    INDEX idx_log_type (log_type)
);

-- For existing databases, run manually:
-- ALTER TABLE verification_log
--     ADD COLUMN log_type VARCHAR(20) NOT NULL DEFAULT 'verification' AFTER reason,
--     ADD COLUMN method VARCHAR(20) NULL AFTER log_type,
--     ADD INDEX idx_log_type (log_type);
