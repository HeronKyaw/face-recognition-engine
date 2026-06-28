import logging
import numpy as np
import cv2
import onnxruntime
from typing import Optional
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

try:
    import mediapipe as mp
    _HAS_MEDIAPIPE = True
except ImportError:
    _HAS_MEDIAPIPE = False
    logger.warning(
        "mediapipe not installed. Face detection and alignment will be disabled. "
        "Install it with: pip install mediapipe"
    )

# MediaPipe Face Mesh landmark indices for the 5 ArcFace alignment points
# Using inner+outer eye corners to compute eye centers, nose tip, and mouth corners
_LEFT_EYE_OUTER = 33
_LEFT_EYE_INNER = 133
_RIGHT_EYE_OUTER = 263
_RIGHT_EYE_INNER = 362
_NOSE_TIP = 1
_LEFT_MOUTH = 61
_RIGHT_MOUTH = 291

# Canonical landmark positions for 112x112 aligned face (ArcFace/InsightFace standard)
_ALIGN_CANONICAL = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041],
], dtype=np.float64)


class OpenCVService:
    _session: Optional[onnxruntime.InferenceSession] = None
    _input_name: Optional[str] = None
    _output_name: Optional[str] = None
    _face_mesh: Optional[object] = None

    @classmethod
    def initialize(cls) -> None:
        if cls._session is not None:
            logger.warning("ONNX model already loaded")
            return

        model_path = Path(settings.model_path)
        if not model_path.exists():
            raise FileNotFoundError(
                f"ONNX model not found at {model_path}. "
                f"Ensure arcface_mobilefacenet.onnx is in models/ directory."
            )

        try:
            cls._session = onnxruntime.InferenceSession(
                str(model_path),
                providers=["CPUExecutionProvider"]
            )

            cls._input_name = cls._session.get_inputs()[0].name
            cls._output_name = cls._session.get_outputs()[0].name

            logger.info(
                f"ONNX model loaded: {model_path}, "
                f"input_size={settings.input_size}, "
                f"embedding_dim={settings.embedding_dim}"
            )

            cls._init_mediapipe()
            cls._warmup()

        except Exception as e:
            logger.error(f"Failed to load ONNX model: {e}")
            raise

    @classmethod
    def _init_mediapipe(cls) -> None:
        if not _HAS_MEDIAPIPE:
            logger.warning(
                "MediaPipe not available. Face detection and alignment disabled."
            )
            return
        if cls._face_mesh is not None:
            return
        cls._face_mesh = mp.solutions.face_mesh.FaceMesh(
            static_image_mode=True,
            max_num_faces=1,
            min_detection_confidence=0.5,
        )
        logger.info("MediaPipe Face Mesh initialized")

    @classmethod
    def _warmup(cls) -> None:
        dummy_input = np.random.randint(0, 255, (112, 112, 3), dtype=np.uint8)
        try:
            _ = cls.extract_embedding(dummy_input, skip_detection=True)
        except RuntimeError:
            pass
        logger.info("ONNX model warmed up")

    @classmethod
    def close(cls) -> None:
        cls._session = None
        cls._input_name = None
        cls._output_name = None
        if cls._face_mesh is not None:
            cls._face_mesh.close()
            cls._face_mesh = None
        logger.info("ONNX model released")

    @classmethod
    def _ensure_initialized(cls) -> None:
        if cls._session is None:
            raise RuntimeError("ONNX model not loaded. Call initialize() first.")

    @classmethod
    def detect_and_align_face(cls, image: np.ndarray) -> np.ndarray:
        if cls._face_mesh is None:
            if not _HAS_MEDIAPIPE:
                raise RuntimeError(
                    "MediaPipe is required for face detection and alignment. "
                    "Install it with: pip install mediapipe"
                )
            raise RuntimeError("MediaPipe not initialized. Call initialize() first.")

        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        results = cls._face_mesh.process(rgb)

        if not results or not results.multi_face_landmarks:
            raise ValueError("No face detected in image")

        landmarks = results.multi_face_landmarks[0]
        h, w = image.shape[:2]

        src_points = np.array([
            [
                (landmarks.landmark[_LEFT_EYE_OUTER].x + landmarks.landmark[_LEFT_EYE_INNER].x) / 2 * w,
                (landmarks.landmark[_LEFT_EYE_OUTER].y + landmarks.landmark[_LEFT_EYE_INNER].y) / 2 * h,
            ],
            [
                (landmarks.landmark[_RIGHT_EYE_OUTER].x + landmarks.landmark[_RIGHT_EYE_INNER].x) / 2 * w,
                (landmarks.landmark[_RIGHT_EYE_OUTER].y + landmarks.landmark[_RIGHT_EYE_INNER].y) / 2 * h,
            ],
            [
                landmarks.landmark[_NOSE_TIP].x * w,
                landmarks.landmark[_NOSE_TIP].y * h,
            ],
            [
                landmarks.landmark[_LEFT_MOUTH].x * w,
                landmarks.landmark[_LEFT_MOUTH].y * h,
            ],
            [
                landmarks.landmark[_RIGHT_MOUTH].x * w,
                landmarks.landmark[_RIGHT_MOUTH].y * h,
            ],
        ], dtype=np.float64)

        tform = cv2.estimateAffinePartial2D(src_points, _ALIGN_CANONICAL)
        if tform is None or len(tform[0]) == 0:
            raise ValueError("Face alignment failed")

        aligned = cv2.warpAffine(
            image, tform[0], (112, 112),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_CONSTANT,
            borderValue=(127, 127, 127),
        )

        return aligned

    @classmethod
    def preprocess_image(cls, image: np.ndarray) -> np.ndarray:
        resized = cv2.resize(image, settings.input_size, interpolation=cv2.INTER_LINEAR)

        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)

        normalized = (rgb.astype(np.float32) - 127.5) / 128.0

        blob = np.expand_dims(normalized, axis=0).astype(np.float32)

        return blob

    @classmethod
    def extract_embedding(cls, image: np.ndarray, skip_detection: bool = False) -> np.ndarray:
        cls._ensure_initialized()

        if image is None or image.size == 0:
            raise ValueError("Invalid input image: empty or None")

        if len(image.shape) != 3 or image.shape[2] != 3:
            raise ValueError(f"Expected 3-channel BGR image, got shape {image.shape}")

        try:
            if not skip_detection and cls._face_mesh is not None:
                image = cls.detect_and_align_face(image)

            blob = cls.preprocess_image(image)

            output = cls._session.run(
                [cls._output_name],
                {cls._input_name: blob}
            )[0]

            embedding = output.flatten()

            norm = np.linalg.norm(embedding)
            if norm > 0:
                embedding = embedding / norm

            return embedding.astype(np.float32)

        except ValueError:
            raise
        except Exception as e:
            logger.error(f"ONNX inference error: {e}")
            raise RuntimeError(f"Face embedding extraction failed: {e}")

    @classmethod
    def extract_embedding_from_bytes(cls, image_bytes: bytes) -> np.ndarray:
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("Failed to decode image bytes. Invalid format or corrupted data.")

        return cls.extract_embedding(image)

    @classmethod
    def health_check(cls) -> bool:
        try:
            cls._ensure_initialized()
            dummy = np.zeros((112, 112, 3), dtype=np.uint8)
            _ = cls.extract_embedding(dummy, skip_detection=True)
            return True
        except Exception as e:
            logger.error(f"OpenCV service health check failed: {e}")
            return False
