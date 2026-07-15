import logging
import uuid
import random
import time
from dataclasses import dataclass, field
from typing import Optional

from app.config import get_settings
from app.services.liveness_service import LivenessService

logger = logging.getLogger(__name__)
settings = get_settings()

ACTION_POOL = [
    "smile",
    "turn_left",
    "turn_right",
    "blink",
]


@dataclass
class ChallengeSession:
    challenge_id: str
    steps: list[dict]
    created_at: float
    expires_at: float
    verified_steps: set = field(default_factory=set)


class ChallengeService:
    _sessions: dict[str, ChallengeSession] = {}

    @classmethod
    def initialize(cls) -> None:
        logger.info("ChallengeService initialized")

    @classmethod
    def close(cls) -> None:
        cls._sessions.clear()
        logger.info("ChallengeService closed")

    @classmethod
    def _generate_sequence(cls) -> list[dict]:
        num_steps = random.randint(settings.challenge_min_steps, settings.challenge_max_steps)
        pool = list(ACTION_POOL)
        random.shuffle(pool)

        steps = []
        selected = pool[:num_steps]
        for action in selected:
            params = {}
            if action == "blink":
                params["count"] = random.randint(settings.challenge_min_blinks, settings.challenge_max_blinks)
            elif action in ("turn_left", "turn_right"):
                params["direction"] = action.split("_")[-1]
            steps.append({"action": action, "params": params})

        return steps

    @classmethod
    def init_challenge(cls) -> dict:
        now = time.time()
        challenge_id = uuid.uuid4().hex[:16]
        steps = cls._generate_sequence()

        session = ChallengeSession(
            challenge_id=challenge_id,
            steps=steps,
            created_at=now,
            expires_at=now + settings.challenge_timeout_seconds,
        )
        cls._sessions[challenge_id] = session
        cls._cleanup_expired()

        safe_steps = []
        for s in steps:
            sp = dict(s)
            if "count" in sp["params"]:
                sp["instruction"] = f"Blink {sp['params']['count']} times"
            elif "direction" in sp["params"]:
                direction = sp["params"]["direction"]
                sp["instruction"] = f"Turn your head to the {direction}"
            elif sp["action"] == "look_straight":
                sp["instruction"] = "Look straight at the camera"
            elif sp["action"] == "smile":
                sp["instruction"] = "Smile"
            elif sp["action"] == "mouth_open":
                sp["instruction"] = "Open your mouth"

            safe_steps.append({
                "action": sp["action"],
                "instruction": sp["instruction"],
            })

        return {
            "challenge_id": challenge_id,
            "steps": safe_steps,
            "total_steps": len(steps),
            "expires_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(session.expires_at)),
        }

    @classmethod
    def verify_step(cls, challenge_id: str, step_index: int, frames: list) -> dict:
        session = cls._sessions.get(challenge_id)
        if session is None:
            return {"passed": False, "message": "Challenge session not found or expired"}

        if time.time() > session.expires_at:
            cls._sessions.pop(challenge_id, None)
            return {"passed": False, "message": "Challenge session expired"}

        if step_index < 0 or step_index >= len(session.steps):
            return {"passed": False, "message": f"Invalid step index {step_index}"}

        if step_index in session.verified_steps:
            return {"passed": False, "message": f"Step {step_index} already verified"}

        step = session.steps[step_index]
        action = step["action"]
        params = step["params"]

        decoded_frames = LivenessService.decode_frames(frames)

        passed = LivenessService.verify_step_action(action, params, decoded_frames)

        if passed:
            session.verified_steps.add(step_index)

        completed = passed and len(session.verified_steps) == len(session.steps)
        next_step = step_index + 1 if (passed and not completed) else None

        return {
            "passed": passed,
            "step_index": step_index,
            "next_step_index": next_step,
            "completed": completed,
            "message": "" if passed else f"Action '{action}' not detected",
        }

    @classmethod
    def verify_full_challenge(cls, challenge_id: str) -> bool:
        session = cls._sessions.get(challenge_id)
        if session is None:
            return False
        return len(session.verified_steps) == len(session.steps)

    @classmethod
    def _cleanup_expired(cls) -> None:
        now = time.time()
        expired = [cid for cid, s in cls._sessions.items() if now > s.expires_at]
        for cid in expired:
            cls._sessions.pop(cid, None)
