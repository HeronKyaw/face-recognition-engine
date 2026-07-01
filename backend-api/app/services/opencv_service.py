import logging
import os
import urllib.request
import numpy as np
from typing import Optional
from pathlib import Path
from huggingface_hub import hf_hub_download

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def _download_file(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    logger.info(f"Downloading {url} to {dest}")
    urllib.request.urlretrieve(url, dest)
    logger.info(f"Downloaded {dest}")
    return dest


def _l2_normalize(embedding: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(embedding)
    if norm < 1e-6:
        raise RuntimeError("Near-zero embedding vector after normalization")
    return embedding / norm


class OpenCVService:
    _engine: Optional[object] = None
    _ort_session: Optional[object] = None
    _ort_input_name: Optional[str] = None

    @classmethod
    def initialize(cls) -> None:
        if cls._engine is not None:
            logger.warning("Face engine already loaded")
            return

        cache_dir = Path(settings.face_detect_model_path or
                         os.path.join(os.path.dirname(__file__), "..", "..", "models"))

        face_detect_path = Path(cache_dir) / "face_detection_yunet_2026may.onnx"
        if not face_detect_path.exists():
            face_detect_path = _download_file(
                settings.face_detect_model_url, face_detect_path
            )

        try:
            rec_model_path = Path(hf_hub_download(
                repo_id=settings.model_repo_id,
                filename=settings.model_filename
            ))
        except Exception as e:
            raise RuntimeError(
                f"Failed to download recognition model {settings.model_repo_id}/{settings.model_filename}: {e}"
            )

        try:
            import opencv5_native
            cls._engine = opencv5_native.FaceEngine(
                str(face_detect_path),
                input_size=settings.input_size[0],
                embedding_dim=settings.embedding_dim,
            )
            logger.info(
                f"OpenCV 5 native engine loaded: rec_model={settings.model_repo_id}/{settings.model_filename}, "
                f"face_detect={face_detect_path}, "
                f"input_size={settings.input_size}, embedding_dim={settings.embedding_dim}"
            )

            import onnxruntime
            cls._ort_session = onnxruntime.InferenceSession(
                str(rec_model_path),
                providers=["CPUExecutionProvider"]
            )
            cls._ort_input_name = cls._ort_session.get_inputs()[0].name
            logger.info(f"ONNX Runtime inference session created for {settings.model_filename}")

            if not cls.health_check():
                raise RuntimeError("Engine health check failed after initialization")

        except ImportError:
            raise RuntimeError(
                "opencv5_native or onnxruntime not found. Ensure dependencies are installed."
            )
        except Exception as e:
            logger.error(f"Failed to initialize engine: {e}")
            raise

    @classmethod
    def close(cls) -> None:
        cls._engine = None
        cls._ort_session = None
        cls._ort_input_name = None
        logger.info("Engine released")

    @classmethod
    def _ensure_initialized(cls) -> None:
        if cls._engine is None:
            raise RuntimeError("Engine not loaded. Call initialize() first.")
        if cls._ort_session is None:
            raise RuntimeError("ONNX Runtime session not loaded")

    @classmethod
    def extract_embedding(cls, image: np.ndarray) -> np.ndarray:
        cls._ensure_initialized()

        if image is None or image.size == 0:
            raise ValueError("Invalid input image: empty or None")

        if len(image.shape) != 3 or image.shape[2] != 3:
            raise ValueError(f"Expected 3-channel BGR image, got shape {image.shape}")

        h, w = image.shape[:2]
        raw_bytes = image.tobytes()

        try:
            aligned_pixels = cls._engine.extract_embedding_from_raw(
                list(raw_bytes), w, h
            )
            return cls._run_onnx_recognition(aligned_pixels)
        except RuntimeError as e:
            msg = str(e).lower()
            if "no face" in msg or "face alignment" in msg:
                raise ValueError(str(e))
            raise
        except ValueError:
            raise
        except Exception as e:
            logger.error(f"Native inference error: {e}")
            raise RuntimeError(f"Face embedding extraction failed: {e}")

    @classmethod
    def extract_embedding_from_bytes(cls, image_bytes: bytes) -> np.ndarray:
        cls._ensure_initialized()

        if not image_bytes:
            raise ValueError("Empty image bytes")

        try:
            aligned_pixels = cls._engine.extract_embedding(list(image_bytes))
            return cls._run_onnx_recognition(aligned_pixels)
        except RuntimeError as e:
            msg = str(e).lower()
            if "decode" in msg:
                raise ValueError(f"Failed to decode image bytes: {e}")
            if "no face" in msg or "face alignment" in msg:
                raise ValueError(str(e))
            raise
        except ValueError:
            raise
        except Exception as e:
            logger.error(f"Native inference error: {e}")
            raise RuntimeError(f"Face embedding extraction failed: {e}")

    @classmethod
    def _run_onnx_recognition(cls, aligned_pixels: list) -> np.ndarray:
        h, w = settings.input_size

        img = np.array(aligned_pixels, dtype=np.float32).reshape(h, w, 3)
        img = img[:, :, ::-1]
        img = (img - 127.5) / 128.0
        img = np.transpose(img, (2, 0, 1))
        img = np.expand_dims(img, axis=0).astype(np.float32)

        embedding = cls._ort_session.run(
            None, {cls._ort_input_name: img}
        )[0].flatten()

        return _l2_normalize(embedding)

    @classmethod
    def health_check(cls) -> bool:
        try:
            cls._ensure_initialized()
            return cls._engine.health_check()
        except Exception as e:
            logger.error(f"Engine health check failed: {e}")
            return False
