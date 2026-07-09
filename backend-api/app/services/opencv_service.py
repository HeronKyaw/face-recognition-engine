import logging
import urllib.request
import numpy as np
import cv2
from typing import Optional, Tuple
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

try:
    import mediapipe as mp
    _HAS_MEDIAPIPE = True
    # Detect API version: old (solutions) vs new (tasks)
    _MP_OLD_API = hasattr(mp, 'solutions')
    if not _MP_OLD_API:
        logger.info("Using MediaPipe tasks API (new)")
    else:
        logger.info("Using MediaPipe solutions API (legacy)")
except ImportError:
    _HAS_MEDIAPIPE = False
    _MP_OLD_API = False
    logger.warning(
        "mediapipe not installed. Face detection will be disabled. "
        "Install it with: pip install mediapipe"
    )


class OpenCVService:
    _recognizer: Optional[cv2.FaceRecognizerSF] = None
    _face_mesh: Optional[object] = None

    @classmethod
    def initialize(cls) -> None:
        if cls._recognizer is not None:
            logger.warning("SFace model already loaded")
            return

        model_path = Path(settings.model_path)
        if not model_path.is_absolute():
            model_path = Path(__file__).resolve().parent.parent.parent / model_path

        if not model_path.exists():
            model_path.parent.mkdir(parents=True, exist_ok=True)
            model_url = "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"
            logger.info(f"Downloading SFace model from {model_url}...")
            urllib.request.urlretrieve(model_url, str(model_path))
            logger.info(f"SFace model downloaded to {model_path}")

        try:
            cls._recognizer = cv2.FaceRecognizerSF.create(
                model=str(model_path),
                config="",
                backend_id=cv2.dnn.DNN_BACKEND_OPENCV,
                target_id=cv2.dnn.DNN_TARGET_CPU,
            )

            logger.info(
                f"SFace model loaded: {model_path}, "
                f"input_size={settings.input_size}, "
                f"embedding_dim={settings.embedding_dim}"
            )

            cls._init_mediapipe()
            cls._warmup()

        except Exception as e:
            logger.error(f"Failed to load SFace model: {e}")
            raise

    @classmethod
    def _init_mediapipe(cls) -> None:
        if not _HAS_MEDIAPIPE:
            logger.warning(
                "MediaPipe not available. Face detection disabled."
            )
            return
        if cls._face_mesh is not None:
            return

        if _MP_OLD_API:
            cls._face_mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=True,
                max_num_faces=1,
                min_detection_confidence=0.5,
            )
        else:
            model_dir = Path(__file__).resolve().parent.parent.parent / "models"
            model_path = model_dir / "face_landmarker.task"
            if not model_path.exists():
                model_dir.mkdir(parents=True, exist_ok=True)
                model_url = (
                    "https://storage.googleapis.com/mediapipe-models/"
                    "face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
                )
                logger.info(f"Downloading FaceLandmarker model from {model_url}...")
                urllib.request.urlretrieve(model_url, str(model_path))
                logger.info(f"FaceLandmarker model downloaded to {model_path}")
            vision = mp.tasks.vision
            cls._face_mesh = vision.FaceLandmarker.create_from_options(
                options=vision.FaceLandmarkerOptions(
                    base_options=mp.tasks.BaseOptions(model_asset_path=str(model_path)),
                    running_mode=vision.RunningMode.IMAGE,
                    num_faces=1,
                    min_face_detection_confidence=0.5,
                )
            )
        logger.info("MediaPipe Face Landmarker initialized")

    @classmethod
    def _warmup(cls) -> None:
        dummy_input = np.zeros((112, 112, 3), dtype=np.uint8)
        try:
            _ = cls.extract_embedding(dummy_input, skip_detection=True)
        except RuntimeError:
            pass
        logger.info("SFace model warmed up")

    @classmethod
    def close(cls) -> None:
        cls._recognizer = None
        if cls._face_mesh is not None:
            try:
                cls._face_mesh.close()
            except Exception:
                pass
            cls._face_mesh = None
        logger.info("SFace model released")

    @classmethod
    def _ensure_initialized(cls) -> None:
        if cls._recognizer is None:
            raise RuntimeError("SFace model not loaded. Call initialize() first.")

    @classmethod
    def _detect_face(cls, image: np.ndarray) -> Optional[Tuple[Tuple[int, int, int, int], list]]:
        """Returns ((bbox_x, bbox_y, bbox_w, bbox_h), landmarks) or None."""
        if cls._face_mesh is None:
            if not _HAS_MEDIAPIPE:
                raise RuntimeError(
                    "MediaPipe is required for face detection. "
                    "Install it with: pip install mediapipe"
                )
            raise RuntimeError("MediaPipe not initialized. Call initialize() first.")

        h, w = image.shape[:2]
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        if _MP_OLD_API:
            results = cls._face_mesh.process(rgb)
            if not results or not results.multi_face_landmarks:
                return None
            landmarks = results.multi_face_landmarks[0].landmark
        else:
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            results = cls._face_mesh.detect(mp_image)
            if not results or not results.face_landmarks:
                return None
            landmarks = results.face_landmarks[0]

        xs = [lm.x * w for lm in landmarks]
        ys = [lm.y * h for lm in landmarks]

        x, y = int(min(xs)), int(min(ys))
        x2, y2 = int(max(xs)), int(max(ys))

        pad_x = int((x2 - x) * 0.2)
        pad_y = int((y2 - y) * 0.2)

        x = max(0, x - pad_x)
        y = max(0, y - pad_y)
        x2 = min(w, x2 + pad_x)
        y2 = min(h, y2 + pad_y)

        return ((x, y, x2 - x, y2 - y), landmarks)

    @classmethod
    def _get_face_bbox(cls, image: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
        result = cls._detect_face(image)
        if result is None:
            return None
        return result[0]

    @classmethod
    def get_face_landmarks(cls, image: np.ndarray) -> Optional[list]:
        """Returns MediaPipe face landmarks for the first detected face, or None."""
        result = cls._detect_face(image)
        if result is None:
            return None
        return result[1]

    @classmethod
    def estimate_head_pose(cls, image: np.ndarray, landmarks: Optional[list] = None) -> Optional[dict]:
        if landmarks is None:
            landmarks = cls.get_face_landmarks(image)
        if landmarks is None:
            return None
        h, w = image.shape[:2]

        image_points = np.array([
            (landmarks[1].x * w, landmarks[1].y * h),
            (landmarks[168].x * w, landmarks[168].y * h),
            (landmarks[33].x * w, landmarks[33].y * h),
            (landmarks[263].x * w, landmarks[263].y * h),
            (landmarks[61].x * w, landmarks[61].y * h),
            (landmarks[291].x * w, landmarks[291].y * h),
            (landmarks[199].x * w, landmarks[199].y * h),
        ], dtype=np.float64)

        model_points = np.array([
            (0.0, 0.0, 0.0),
            (0.0, -330.0, -65.0),
            (-225.0, 170.0, -135.0),
            (225.0, 170.0, -135.0),
            (-150.0, -150.0, -125.0),
            (150.0, -150.0, -125.0),
            (0.0, -330.0, -65.0),
        ], dtype=np.float64)

        focal_length = w
        center = (w / 2, h / 2)
        camera_matrix = np.array([
            [focal_length, 0, center[0]],
            [0, focal_length, center[1]],
            [0, 0, 1],
        ], dtype=np.float64)
        dist_coeffs = np.zeros((4, 1))

        success, rvec, _ = cv2.solvePnP(
            model_points, image_points, camera_matrix, dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE
        )
        if not success:
            return None

        rmat, _ = cv2.Rodrigues(rvec)
        sy = np.sqrt(rmat[0, 0] ** 2 + rmat[1, 0] ** 2)
        singular = sy < 1e-6
        if not singular:
            x = np.degrees(np.arctan2(rmat[2, 1], rmat[2, 2]))
            y = np.degrees(np.arctan2(-rmat[2, 0], sy))
            z = np.degrees(np.arctan2(rmat[1, 0], rmat[0, 0]))
        else:
            x = np.degrees(np.arctan2(-rmat[1, 2], rmat[1, 1]))
            y = np.degrees(np.arctan2(-rmat[2, 0], sy))
            z = 0

        return {"yaw": float(y), "pitch": float(x), "roll": float(z)}

    @classmethod
    def _crop_and_resize(cls, image: np.ndarray, bbox: Tuple[int, int, int, int]) -> np.ndarray:
        """Crop face region and resize to 112x112.

        OpenCV 5.x's alignCrop has a non-deterministic bug producing
        inconsistent alignments and sometimes blank crops, so we use
        a direct crop + resize instead for reliability.
        """
        x, y, w, h = bbox
        face = image[y:y + h, x:x + w]
        if face.size == 0:
            raise ValueError("Empty face crop from bbox")
        return cv2.resize(face, (112, 112))

    @classmethod
    def extract_embedding(cls, image: np.ndarray, skip_detection: bool = False) -> np.ndarray:
        cls._ensure_initialized()

        if image is None or image.size == 0:
            raise ValueError("Invalid input image: empty or None")

        if len(image.shape) != 3 or image.shape[2] != 3:
            raise ValueError(f"Expected 3-channel BGR image, got shape {image.shape}")

        try:
            if not skip_detection:
                bbox = cls._get_face_bbox(image)
                if bbox is None:
                    raise ValueError("No face detected in image")
                aligned_face = cls._crop_and_resize(image, bbox)
            else:
                aligned_face = image

            features = cls._recognizer.feature(aligned_face)
            embedding = features.flatten()

            raw_norm = np.linalg.norm(embedding)
            logger.info(f"Embedding stats: raw_norm={raw_norm:.6f}, range=[{embedding.min():.6f}, {embedding.max():.6f}], first5={embedding[:5].tolist()}")
            if raw_norm > 0:
                embedding = embedding / raw_norm

            return embedding.astype(np.float32)

        except ValueError:
            raise
        except Exception as e:
            logger.error(f"SFace inference error: {e}")
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
            logger.error(f"SFace health check failed: {e}")
            return False
