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
    chroma_distance_threshold: float = float(os.getenv("CHROMA_DISTANCE_THRESHOLD", "0.4"))

    # OpenCV / Model Configuration
    model_path: str = os.getenv("MODEL_PATH", "/app/models/arcface_mobilefacenet.onnx")
    input_size: tuple = (112, 112)
    embedding_dim: int = 512

    # API Configuration
    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "8000"))
    api_workers: int = int(os.getenv("API_WORKERS", "4"))

    # Distance threshold for face verification (cosine distance)
    verification_threshold: float = float(os.getenv("VERIFICATION_THRESHOLD", "0.4"))

    class Config:
        env_file = ".env"
        case_sensitive = False
        protected_namespaces = ("settings_",)


@lru_cache()
def get_settings() -> Settings:
    return Settings()