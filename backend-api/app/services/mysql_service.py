"""
MySQL Service with Connection Pooling

Why Connection Pooling?
- Creating a new TCP connection to MySQL for each request is expensive (~10-50ms)
- Pool maintains persistent connections, reusing them across requests
- pool_size=10: Keeps 10 connections open (adjust based on CPU cores * 2-4)
- max_overflow=20: Allows burst up to 30 connections under load
- pool_pre_ping=True: Validates connections before use (handles MySQL wait_timeout)
- pool_recycle=3600: Recycles connections hourly (prevents stale connections)

Why mysql-connector-python?
- Pure Python driver (no C extensions needed in Docker)
- Native connection pooling support
- Compatible with MySQL 8.0+
- Async support via asyncmy if needed later

Schema Assumptions (identity_db.users):
- user_id: VARCHAR(50) PRIMARY KEY - Business key, not auto-increment
- name: VARCHAR(150) NOT NULL
- metadata: TEXT - JSON string for flexible attributes
- created_at: TIMESTAMP DEFAULT CURRENT_TIMESTAMP
"""
import logging
import json
from contextlib import contextmanager
from typing import Optional, Generator
from datetime import datetime

import mysql.connector
from mysql.connector import pooling, Error as MySQLError
from mysql.connector.connection import MySQLConnection
from mysql.connector.pooling import MySQLConnectionPool

from app.config import get_settings
from app.schemas.user import UserCreate, UserUpdate, UserResponse, VerificationLogResponse

logger = logging.getLogger(__name__)
settings = get_settings()


class MySQLService:
    """
    MySQL service with connection pooling for identity management.
    
    Thread Safety:
    - MySQLConnectionPool is thread-safe
    - get_connection() returns a connection from pool (thread-local)
    - Each request gets its own connection via context manager
    """
    
    _pool: Optional[MySQLConnectionPool] = None
    
    @classmethod
    def initialize(cls) -> None:
        """Initialize connection pool at application startup."""
        if cls._pool is not None:
            logger.warning("MySQL connection pool already initialized")
            return
        
        try:
            cls._pool = pooling.MySQLConnectionPool(
                pool_name="identity_pool",
                pool_size=settings.mysql_pool_size,
                pool_reset_session=True,
                host=settings.mysql_host,
                port=settings.mysql_port,
                user=settings.mysql_user,
                password=settings.mysql_password,
                database=settings.mysql_database,
                autocommit=False,
                charset="utf8mb4",
                collation="utf8mb4_unicode_ci",
                connection_timeout=10,
            )
            logger.info(
                f"MySQL connection pool initialized: "
                f"pool_size={settings.mysql_pool_size}, "
                f"host={settings.mysql_host}:{settings.mysql_port}, "
                f"db={settings.mysql_database}"
            )
        except MySQLError as e:
            logger.error(f"Failed to initialize MySQL pool: {e}")
            raise
    
    @classmethod
    def close(cls) -> None:
        """Close all connections in the pool."""
        if cls._pool is not None:
            try:
                cls._pool.close()
            except AttributeError:
                pass
            cls._pool = None
            logger.info("MySQL connection pool closed")
    
    @classmethod
    @contextmanager
    def get_connection(cls) -> Generator[MySQLConnection, None, None]:
        """
        Get a connection from the pool using context manager.
        
        Usage:
            with MySQLService.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(...)
                conn.commit()
        
        Connection automatically returned to pool on exit.
        Commits on success, rolls back on exception.
        """
        if cls._pool is None:
            raise RuntimeError("MySQL pool not initialized. Call initialize() first.")
        
        conn: MySQLConnection = cls._pool.get_connection()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
    
    # ==================== User CRUD Operations ====================
    
    @classmethod
    def create_user(cls, user: UserCreate) -> UserResponse:
        """
        Create a new user record in MySQL.
        
        Anti-fraud note: Does NOT enroll face. Face enrollment is separate
        via /enroll endpoint which requires user_id to exist first.
        """
        query = """
            INSERT INTO users (user_id, name, metadata)
            VALUES (%s, %s, %s)
        """
        metadata_json = user.metadata if user.metadata else None
        
        with cls.get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute(query, (user.user_id, user.name, metadata_json))
            except mysql.connector.IntegrityError as e:
                if e.errno == 1062:  # Duplicate entry
                    raise ValueError(f"User with user_id '{user.user_id}' already exists")
                raise
            
            # Fetch created record
            return cls._fetch_user_by_id(cursor, user.user_id)
    
    @classmethod
    def _user_from_row(cls, row: dict) -> UserResponse:
        """Convert a dictionary row (from dictionary=True cursor) to UserResponse."""
        return UserResponse(
            user_id=row["user_id"],
            name=row["name"],
            metadata=row["metadata"],
            face_enrolled=bool(row["face_enrolled"]),
            created_at=row["created_at"],
        )

    @classmethod
    def get_user(cls, user_id: str) -> Optional[UserResponse]:
        """Fetch a single user by user_id."""
        query = "SELECT user_id, name, metadata, face_enrolled, created_at FROM users WHERE user_id = %s"
        
        with cls.get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(query, (user_id,))
            row = cursor.fetchone()
            
            if row:
                return cls._user_from_row(row)
            return None
    
    @classmethod
    def _fetch_user_by_id(cls, cursor, user_id: str) -> UserResponse:
        """Fetch user using existing cursor (within transaction)."""
        cursor.execute(
            "SELECT user_id, name, metadata, face_enrolled, created_at FROM users WHERE user_id = %s",
            (user_id,)
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"User {user_id} not found after creation")
        
        return UserResponse(
            user_id=row[0],
            name=row[1],
            metadata=row[2],
            face_enrolled=bool(row[3]),
            created_at=row[4],
        )
    
    @classmethod
    def list_users(cls, page: int = 1, page_size: int = 50) -> tuple[list[UserResponse], int]:
        """
        List users with pagination.
        
        Returns:
            Tuple of (users_list, total_count)
        """
        if page < 1:
            page = 1
        if page_size < 1 or page_size > 100:
            page_size = 50
        
        offset = (page - 1) * page_size
        
        with cls.get_connection() as conn:
            cursor = conn.cursor(dictionary=True)
            
            # Total count
            cursor.execute("SELECT COUNT(*) as total FROM users")
            total = cursor.fetchone()["total"]
            
            # Paginated results
            cursor.execute(
                "SELECT user_id, name, metadata, face_enrolled, created_at "
                "FROM users ORDER BY created_at DESC LIMIT %s OFFSET %s",
                (page_size, offset)
            )
            rows = cursor.fetchall()
            
            users = [cls._user_from_row(row) for row in rows]
            
            return users, total
    
    @classmethod
    def update_user(cls, user_id: str, user_update: UserUpdate) -> Optional[UserResponse]:
        """Update user name and/or metadata."""
        # Build dynamic update query
        fields = []
        params = []
        
        if user_update.name is not None:
            fields.append("name = %s")
            params.append(user_update.name)
        
        if user_update.metadata is not None:
            fields.append("metadata = %s")
            params.append(user_update.metadata)
        
        if not fields:
            return cls.get_user(user_id)
        
        params.append(user_id)
        query = f"UPDATE users SET {', '.join(fields)} WHERE user_id = %s"
        
        with cls.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            
            if cursor.rowcount == 0:
                return None
            
            return cls.get_user(user_id)
    
    @classmethod
    def delete_user(cls, user_id: str) -> bool:
        """
        Delete user from MySQL.
        
        Note: ChromaDB vector deletion is handled by the API layer
        to maintain dual-database consistency (see main.py delete endpoint).
        """
        query = "DELETE FROM users WHERE user_id = %s"
        
        with cls.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (user_id,))
            return cursor.rowcount > 0
    
    @classmethod
    def user_exists(cls, user_id: str) -> bool:
        """Check if user exists (used by /enroll endpoint for anti-fraud)."""
        query = "SELECT 1 FROM users WHERE user_id = %s LIMIT 1"
        
        with cls.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (user_id,))
            return cursor.fetchone() is not None
    
    # ==================== Face Enrollment Status ====================

    @classmethod
    def set_face_enrolled(cls, user_id: str, enrolled: bool = True) -> None:
        """Update the face_enrolled flag for a user."""
        query = "UPDATE users SET face_enrolled = %s WHERE user_id = %s"
        with cls.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (enrolled, user_id))

    @classmethod
    def reset_all_face_enrolled(cls) -> int:
        """Set face_enrolled = FALSE for all users.
        
        Returns:
            Number of users whose enrollment status was reset.
        """
        query = "UPDATE users SET face_enrolled = FALSE"
        with cls.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query)
            return cursor.rowcount

    # ==================== Verification Audit Log ====================

    @classmethod
    def log_verification(
        cls,
        user_id: Optional[str],
        distance: Optional[float] = None,
        device_id: Optional[str] = None,
        success: bool = True,
        reason: Optional[str] = None,
    ) -> None:
        """Record a verification attempt in the audit log."""
        query = """
            INSERT INTO verification_log (user_id, device_id, distance, success, reason)
            VALUES (%s, %s, %s, %s, %s)
        """
        with cls.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, (user_id, device_id, distance, success, reason))

    @classmethod
    def get_verification_logs(
        cls,
        user_id: Optional[str] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[VerificationLogResponse], int]:
        """Fetch paginated verification logs, optionally filtered by user_id."""
        if page < 1:
            page = 1
        if page_size < 1 or page_size > 100:
            page_size = 50

        offset = (page - 1) * page_size
        params = []
        where_clause = ""
        if user_id:
            where_clause = "WHERE user_id = %s"
            params.append(user_id)

        count_query = f"SELECT COUNT(*) as total FROM verification_log {where_clause}"
        data_query = f"""
            SELECT id, user_id, device_id, distance, success, reason, created_at
            FROM verification_log {where_clause}
            ORDER BY created_at DESC LIMIT %s OFFSET %s
        """

        with cls.get_connection() as conn:
            cursor = conn.cursor(dictionary=True)

            cursor.execute(count_query, params)
            total = cursor.fetchone()["total"]

            data_params = params + [page_size, offset]
            cursor.execute(data_query, data_params)
            rows = cursor.fetchall()

            logs = [
                VerificationLogResponse(
                    id=row["id"],
                    user_id=row["user_id"],
                    device_id=row["device_id"],
                    distance=row["distance"],
                    success=bool(row["success"]),
                    reason=row.get("reason"),
                    created_at=row["created_at"],
                )
                for row in rows
            ]
            return logs, total

    # ==================== Health Check ====================
    
    @classmethod
    def health_check(cls) -> bool:
        """Verify database connectivity."""
        try:
            with cls.get_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT 1")
                return cursor.fetchone() is not None
        except Exception as e:
            logger.error(f"MySQL health check failed: {e}")
            return False