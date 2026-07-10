import uuid
import time
import threading
import logging
from typing import Optional
from dataclasses import dataclass

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class EnrollSession:
    session_id: str
    user_id: str
    face_image_bytes: bytes
    quality_result: dict
    passive_result: dict
    created_at: float
    expires_at: float


class SessionService:
    _sessions: dict[str, EnrollSession] = {}
    _lock = threading.Lock()

    @classmethod
    def initialize(cls) -> None:
        logger.info("SessionService initialized")

    @classmethod
    def create_session(
        cls,
        user_id: str,
        face_image_bytes: bytes,
        quality_result: dict,
        passive_result: dict,
    ) -> str:
        now = time.time()
        session_id = str(uuid.uuid4())
        session = EnrollSession(
            session_id=session_id,
            user_id=user_id,
            face_image_bytes=face_image_bytes,
            quality_result=quality_result,
            passive_result=passive_result,
            created_at=now,
            expires_at=now + settings.enroll_session_ttl_seconds,
        )
        with cls._lock:
            cls._cleanup_expired()
            cls._sessions[session_id] = session
        logger.info(f"Created enrollment session {session_id} for user '{user_id}'")
        return session_id

    @classmethod
    def get_session(cls, session_id: str) -> Optional[EnrollSession]:
        with cls._lock:
            session = cls._sessions.get(session_id)
            if session is None:
                return None
            if time.time() >= session.expires_at:
                logger.info(f"Session {session_id} expired")
                del cls._sessions[session_id]
                return None
            return session

    @classmethod
    def delete_session(cls, session_id: str) -> None:
        with cls._lock:
            cls._sessions.pop(session_id, None)
        logger.info(f"Deleted enrollment session {session_id}")

    @classmethod
    def _cleanup_expired(cls) -> None:
        now = time.time()
        expired = [sid for sid, s in cls._sessions.items() if now >= s.expires_at]
        for sid in expired:
            logger.info(f"Cleaned up expired session {sid}")
            del cls._sessions[sid]

    @classmethod
    def close(cls) -> None:
        with cls._lock:
            count = len(cls._sessions)
            cls._sessions.clear()
        logger.info(f"Cleared {count} enrollment sessions")
