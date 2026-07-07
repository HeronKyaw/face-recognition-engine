import logging
import numpy as np
import cv2
from dataclasses import dataclass
from typing import Optional

from app.config import get_settings
from app.services.opencv_service import OpenCVService

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class LivenessResult:
    passed: bool
    passive_score: float
    blur_score: float
    color_score: float
    blink_detected: bool
    frame_diversity_ok: bool
    message: str = ""


class LivenessService:
    LEFT_EYE = [33, 160, 158, 133, 153, 144]
    RIGHT_EYE = [362, 385, 387, 263, 373, 380]

    @classmethod
    def initialize(cls) -> None:
        logger.info("LivenessService initialized")

    @classmethod
    def eye_aspect_ratio(cls, landmarks, eye_indices, img_w: int, img_h: int) -> float:
        points = np.array([(landmarks[i].x * img_w, landmarks[i].y * img_h) for i in eye_indices])
        A = np.linalg.norm(points[1] - points[5])
        B = np.linalg.norm(points[2] - points[4])
        C = np.linalg.norm(points[0] - points[3])
        if C == 0:
            return 0.0
        return float((A + B) / (2.0 * C))

    @classmethod
    def compute_ear_for_frame(cls, image: np.ndarray) -> Optional[float]:
        h, w = image.shape[:2]
        landmarks = OpenCVService.get_face_landmarks(image)
        if landmarks is None:
            return None
        left_ear = cls.eye_aspect_ratio(landmarks, cls.LEFT_EYE, w, h)
        right_ear = cls.eye_aspect_ratio(landmarks, cls.RIGHT_EYE, w, h)
        return (left_ear + right_ear) / 2.0

    @classmethod
    def detect_blinks(cls, ear_values: list[Optional[float]]) -> tuple[int, list[float]]:
        valid = [v for v in ear_values if v is not None]
        if len(valid) < settings.min_blinks_required + 1:
            return 0, valid

        threshold = settings.blink_ear_threshold

        below = [v < threshold for v in ear_values if v is not None]
        blinks = 0
        i = 0
        while i < len(below):
            if below[i]:
                start = i
                while i < len(below) and below[i]:
                    i += 1
                duration = i - start
                if 1 <= duration <= 5:
                    if i < len(below):
                        blinks += 1
            else:
                i += 1

        return blinks, valid

    @classmethod
    def assess_blur(cls, image: np.ndarray) -> float:
        if image.size == 0:
            return 0.0
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        laplacian_var = cv2.Laplacian(gray, cv2.CV_64F).var()
        return min(1.0, laplacian_var / 100.0)

    @classmethod
    def assess_color_diversity(cls, image: np.ndarray) -> float:
        if image.size == 0:
            return 0.0
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        s_std = hsv[:, :, 1].std() / 255.0
        v_std = hsv[:, :, 2].std() / 255.0
        return min(1.0, (s_std + v_std))

    @classmethod
    def check_frame_diversity(cls, frames: list[np.ndarray]) -> tuple[bool, float]:
        if len(frames) < 2:
            return False, 0.0
        diffs = []
        for i in range(1, len(frames)):
            diff = cv2.norm(frames[i], frames[i - 1], cv2.NORM_L2)
            diffs.append(diff)
        avg_diff = float(np.mean(diffs))
        return avg_diff >= settings.liveness_frame_diversity_threshold, avg_diff

    @classmethod
    def assess_passive(cls, image: np.ndarray) -> dict:
        blur = cls.assess_blur(image)
        color = cls.assess_color_diversity(image)
        combined = 0.5 * blur + 0.5 * color
        return {
            "passive_score": combined,
            "blur_score": blur,
            "color_score": color,
            "passed": combined >= settings.liveness_passive_threshold,
        }

    @classmethod
    def assess_active(cls, frames: list[np.ndarray]) -> dict:
        ear_values = []
        for frame in frames:
            ear = cls.compute_ear_for_frame(frame)
            ear_values.append(ear)

        blinks_detected, valid_ears = cls.detect_blinks(ear_values)
        return {
            "blink_detected": blinks_detected >= settings.min_blinks_required,
            "blinks_count": blinks_detected,
            "ear_values": valid_ears,
            "passed": blinks_detected >= settings.min_blinks_required,
        }

    @classmethod
    def decode_frames(cls, frames_bytes: list[bytes]) -> list[np.ndarray]:
        decoded = []
        for fb in frames_bytes:
            nparr = np.frombuffer(fb, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is not None:
                decoded.append(img)
        return decoded

    @classmethod
    def full_assessment(cls, image: np.ndarray, frames: list[np.ndarray]) -> LivenessResult:
        passive = cls.assess_passive(image)
        active = cls.assess_active(frames)
        diversity_ok, avg_diff = cls.check_frame_diversity(frames)

        passed = passive["passed"] and active["passed"] and diversity_ok

        failures = []
        if not passive["passed"]:
            failures.append("passive")
        if not active["passed"]:
            failures.append("blink")
        if not diversity_ok:
            failures.append("diversity")

        message = "" if passed else f"Liveness check failed: {', '.join(failures)}"

        return LivenessResult(
            passed=passed,
            passive_score=passive["passive_score"],
            blur_score=passive["blur_score"],
            color_score=passive["color_score"],
            blink_detected=active["blink_detected"],
            frame_diversity_ok=diversity_ok,
            message=message,
        )
