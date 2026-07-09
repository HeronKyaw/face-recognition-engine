import os
from functools import lru_cache
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    app_name: str = "Face Verification API"
    app_version: str = "1.0.0"
    debug: bool = False

    # MySQL Configuration
    mysql_host: str = os.getenv("MYSQL_HOST", "mysql")
    mysql_port: int = int(os.getenv("MYSQL_PORT", "3306"))
    mysql_user: str = os.getenv("MYSQL_USER", "face_recognition_user")
    mysql_password: str = os.getenv("MYSQL_PASSWORD", "F@ceRecognition4PI")
    mysql_database: str = os.getenv("MYSQL_DATABASE", "face_recognition_db")
    mysql_pool_size: int = int(os.getenv("MYSQL_POOL_SIZE", "10"))
    mysql_max_overflow: int = int(os.getenv("MYSQL_MAX_OVERFLOW", "20"))

    # ChromaDB Configuration
    chroma_host: str = os.getenv("CHROMA_HOST", "chromadb")
    chroma_port: int = int(os.getenv("CHROMA_PORT", "8000"))
    chroma_collection_name: str = os.getenv("CHROMA_COLLECTION", "face_embeddings")
    chroma_distance_threshold: float = float(os.getenv("CHROMA_DISTANCE_THRESHOLD", "0.5"))

    # Model Configuration (SFace: OpenCV Zoo face_recognition_sface)
    model_path: str = os.getenv("MODEL_PATH", "models/sface.onnx")
    input_size: tuple = (112, 112)
    embedding_dim: int = 128

    # API Configuration
    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "8000"))
    api_workers: int = int(os.getenv("API_WORKERS", "1"))

    # Distance threshold for face verification (cosine distance)
    # SFace default: 0.363 cosine similarity → 0.637 distance
    # Conservative for KYC: 0.3 distance (tighter security given observed genuine distance ~0.006)
    verification_threshold: float = float(os.getenv("VERIFICATION_THRESHOLD", "0.3"))

    # Liveness Detection Configuration
    # Passive liveness: texture/blur/color analysis on single image (0-1, higher = more likely live)
    liveness_passive_threshold: float = float(os.getenv("LIVENESS_PASSIVE_THRESHOLD", "0.3"))
    # Active liveness (blink detection): EAR threshold for considering eye closed
    blink_ear_threshold: float = float(os.getenv("BLINK_EAR_THRESHOLD", "0.2"))
    # Minimum number of blinks required in the frame sequence
    min_blinks_required: int = int(os.getenv("MIN_BLINKS_REQUIRED", "1"))
    # Minimum number of liveness frames required
    liveness_min_frames: int = int(os.getenv("LIVENESS_MIN_FRAMES", "5"))
    # Minimum average pixel difference between consecutive frames to detect static images
    liveness_frame_diversity_threshold: float = float(os.getenv("LIVENESS_FRAME_DIVERSITY_THRESHOLD", "15.0"))

    # Challenge-Response Liveness Configuration
    challenge_timeout_seconds: int = int(os.getenv("CHALLENGE_TIMEOUT_SECONDS", "60"))
    challenge_min_steps: int = int(os.getenv("CHALLENGE_MIN_STEPS", "2"))
    challenge_max_steps: int = int(os.getenv("CHALLENGE_MAX_STEPS", "4"))
    challenge_frames_per_step: int = int(os.getenv("CHALLENGE_FRAMES_PER_STEP", "15"))
    challenge_frame_interval_ms: int = int(os.getenv("CHALLENGE_FRAME_INTERVAL_MS", "80"))
    challenge_head_turn_yaw_threshold: float = float(os.getenv("CHALLENGE_HEAD_TURN_YAW_THRESHOLD", "20.0"))
    challenge_mouth_open_mar_threshold: float = float(os.getenv("CHALLENGE_MOUTH_OPEN_MAR_THRESHOLD", "0.5"))
    challenge_smile_threshold: float = float(os.getenv("CHALLENGE_SMILE_THRESHOLD", "0.3"))
    challenge_min_blinks: int = int(os.getenv("CHALLENGE_MIN_BLINKS", "1"))
    challenge_max_blinks: int = int(os.getenv("CHALLENGE_MAX_BLINKS", "3"))

    class Config:
        env_file = ".env"
        case_sensitive = False
        protected_namespaces = ("settings_",)


@lru_cache()
def get_settings() -> Settings:
    return Settings()