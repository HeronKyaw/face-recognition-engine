"""
ChromaDB Service for Vector Indexing and 1:N Face Search

Why ChromaDB?
- Purpose-built for vector similarity search with cosine distance
- Embedded or client-server mode; we use client-server for production concurrency
- Automatic HNSW indexing for sub-millisecond 1:N search at scale
- Persistent storage with WAL for durability
- Simple Python client with sync/async support

Dual-Database Consistency:
- MySQL = Source of truth for user identity (CRUD)
- ChromaDB = Vector index for face embeddings (1:N search)
- On user deletion: Must delete from BOTH databases atomically
- On enrollment: Check MySQL first (user exists), then check ChromaDB (face unique), then write to ChromaDB

Anti-Fraud: During enrollment, we search ChromaDB first. If a face matches an existing user (distance < 0.4), 
we reject enrollment - prevents one person registering multiple identities.
"""
import logging
from typing import Optional, List
from dataclasses import dataclass

import numpy as np
import chromadb
from chromadb.config import Settings as ChromaSettings
from chromadb.api.models.Collection import Collection
from chromadb.errors import NotFoundError as ChromaNotFoundError

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class SearchResult:
    """Result from a 1:N vector search."""
    user_id: str
    distance: float
    embedding: List[float]


class ChromaService:
    """
    ChromaDB service for face embedding storage and similarity search.
    
    Architecture Decisions:
    - Single collection for all face embeddings (efficient HNSW index)
    - Document ID = user_id (enables upsert for re-enrollment)
    - Metadata stores user_id for potential filtering
    - Cosine distance: lower = more similar. Threshold configurable via env var
    - Default threshold (0.5) tuned for SFace (OpenCV Zoo) cosine distance
    """
    
    _client: Optional[chromadb.HttpClient] = None
    _collection: Optional[Collection] = None
    
    @classmethod
    def initialize(cls, force: bool = False) -> None:
        """Initialize ChromaDB client and get/create collection on startup.

        Args:
            force: If True, re-initialize even if already initialized (used for recovery).
        """
        if cls._client is not None and not force:
            logger.warning("ChromaDB client already initialized")
            return

        if force:
            cls._client = None
            cls._collection = None
        
        try:
            cls._client = chromadb.HttpClient(
                host=settings.chroma_host,
                port=settings.chroma_port,
                settings=ChromaSettings(
                    anonymized_telemetry=False,
                    allow_reset=True,
                ),
            )
            
            collection_name = settings.chroma_collection_name
            target_dim = settings.embedding_dim
            target_metadata = {"hnsw:space": "cosine", "dimension": str(target_dim)}
            
            # Validate existing collection dimension
            try:
                existing = cls._client.get_collection(name=collection_name)
                existing_meta = existing.metadata or {}
                existing_dim = existing_meta.get("dimension")
                if existing_dim is not None and existing_dim != str(target_dim):
                    logger.warning(
                        f"Dimension mismatch: collection={existing_dim}, "
                        f"config={target_dim}. Recreating collection."
                    )
                    cls._client.delete_collection(collection_name)
                else:
                    # Update metadata in case it was missing (migration from old version)
                    if existing_dim is None:
                        cls._client.delete_collection(collection_name)
                    else:
                        cls._collection = existing
            except Exception:
                pass
            
            # Get or create collection (handles both new and just-deleted case)
            if cls._collection is None:
                cls._collection = cls._client.get_or_create_collection(
                    name=collection_name,
                    metadata=target_metadata,
                )
            
            logger.info(
                f"ChromaDB initialized: host={settings.chroma_host}:{settings.chroma_port}, "
                f"collection={collection_name}, "
                f"count={cls._collection.count()}"
            )
        except Exception as e:
            logger.error(f"Failed to initialize ChromaDB: {e}")
            raise
    
    @classmethod
    def close(cls) -> None:
        """Close ChromaDB client connections."""
        cls._client = None
        cls._collection = None
        logger.info("ChromaDB client closed")
    
    @classmethod
    def _ensure_initialized(cls) -> None:
        """Ensure client and collection are initialized."""
        if cls._client is None or cls._collection is None:
            raise RuntimeError("ChromaDB not initialized. Call initialize() first.")
    
    @classmethod
    def _reinitialize(cls) -> None:
        """Reset and reinitialize ChromaDB client and collection (recovery from stale UUID)."""
        cls._client = None
        cls._collection = None
        cls.initialize()
    
    @classmethod
    def add_embedding(cls, user_id: str, embedding: List[float]) -> bool:
        """
        Add a face embedding to the vector index.
        
        Why upsert (not add)?
        - Idempotent: Safe to call multiple times for same user_id
        - Handles re-enrollment: Updates embedding if user re-enrolls
        - ChromaDB upsert replaces existing vector with same ID
        
        Args:
            user_id: Unique identifier (used as ChromaDB document ID)
            embedding: 128-dim normalized face embedding from SFace
            
        Returns:
            True if added/updated successfully
        """
        cls._ensure_initialized()
        
        try:
            cls._collection.upsert(
                ids=[user_id],
                embeddings=[embedding],
                metadatas=[{"user_id": user_id}],
            )
            logger.info(f"Added/updated embedding for user: {user_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to add embedding for user {user_id}: {e}")
            raise
    
    @classmethod
    def search_embedding(cls, embedding: List[float], n_results: int = 1) -> Optional[SearchResult]:
        """
        Search for the nearest embedding in the vector index (1:N identification).

        Args:
            embedding: Query embedding vector (128-dim, L2-normalized)
            n_results: Number of nearest neighbors to return (default 1)

        Returns:
            SearchResult with user_id, distance, and embedding if found, None otherwise
        """
        cls._ensure_initialized()
        
        try:
            return cls._search_embedding(embedding, n_results)
        except ChromaNotFoundError:
            logger.warning("Collection not found, reinitializing and retrying search...")
            cls._reinitialize()
            return cls._search_embedding(embedding, n_results)
    
    @classmethod
    def _search_embedding(cls, embedding: List[float], n_results: int) -> Optional[SearchResult]:
        """Internal search helper (no reinit logic, for single attempt)."""
        try:
            results = cls._collection.query(
                query_embeddings=[embedding],
                n_results=n_results,
                include=["embeddings", "distances", "metadatas"],
            )
            
            if not results["ids"] or not results["ids"][0]:
                logger.info("ChromaDB search returned no results")
                return None

            collection_count = cls._collection.count()
            best_id = results["ids"][0][0]
            best_distance = results["distances"][0][0]
            best_embedding = results["embeddings"][0][0]
            query_np = np.array(embedding)
            best_np = np.array(best_embedding)
            
            logger.info(f"ChromaDB search: count={collection_count}, best={best_id}, "
                       f"distance={best_distance:.6f}, "
                       f"query_first5={query_np[:5].tolist()}, "
                       f"stored_first5={best_np[:5].tolist()}")
            
            if best_distance < 0.05:
                logger.warning(f"Suspiciously low distance ({best_distance:.6f}) -- "
                              f"embeddings nearly identical, SFace model may be broken")
            
            return SearchResult(
                user_id=best_id,
                distance=max(0.0, best_distance),
                embedding=best_embedding,
            )
        except Exception as e:
            logger.error(f"ChromaDB search failed: {e}")
            raise
    
    @classmethod
    def delete_embedding(cls, user_id: str) -> bool:
        """
        Delete a user's face embedding from the vector index.
        
        Critical for Dual-Database Consistency:
        - Must be called when user is deleted from MySQL
        - Prevents orphaned vectors (face exists but no user record)
        - Prevents false matches against deleted users
        
        Returns:
            True if deleted, False if user_id not found in ChromaDB
        """
        cls._ensure_initialized()
        
        try:
            return cls._delete_embedding(user_id)
        except ChromaNotFoundError:
            logger.warning("Collection not found, reinitializing and retrying delete...")
            cls._reinitialize()
            return cls._delete_embedding(user_id)
    
    @classmethod
    def _delete_embedding(cls, user_id: str) -> bool:
        try:
            existing = cls._collection.get(ids=[user_id], include=[])
            if not existing["ids"]:
                logger.warning(f"Embedding not found in ChromaDB for user: {user_id}")
                return False
            
            cls._collection.delete(ids=[user_id])
            logger.info(f"Deleted embedding for user: {user_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to delete embedding for user {user_id}: {e}")
            raise
    
    @classmethod
    def get_embedding(cls, user_id: str) -> Optional[List[float]]:
        """Retrieve a user's embedding (for debugging/admin)."""
        cls._ensure_initialized()
        
        try:
            return cls._get_embedding(user_id)
        except ChromaNotFoundError:
            logger.warning("Collection not found, reinitializing and retrying get...")
            cls._reinitialize()
            return cls._get_embedding(user_id)
    
    @classmethod
    def _get_embedding(cls, user_id: str) -> Optional[List[float]]:
        try:
            results = cls._collection.get(ids=[user_id], include=["embeddings"])
            if results["embeddings"]:
                return results["embeddings"][0]
            return None
        except Exception as e:
            logger.error(f"Failed to get embedding for user {user_id}: {e}")
            raise
    
    @classmethod
    def count(cls) -> int:
        """Get total number of embeddings in the collection."""
        cls._ensure_initialized()
        return cls._collection.count()
    
    @classmethod
    def reset_all_embeddings(cls) -> int:
        """Delete all face embeddings by recreating the collection.
        
        Returns:
            Number of embeddings that were deleted before reset.
        """
        cls._ensure_initialized()
        collection_name = settings.chroma_collection_name
        target_metadata = {"hnsw:space": "cosine", "dimension": str(settings.embedding_dim)}
        
        prev_count = cls._collection.count()
        cls._client.delete_collection(collection_name)
        cls._collection = cls._client.get_or_create_collection(
            name=collection_name,
            metadata=target_metadata,
        )
        logger.warning(f"All embeddings reset: {prev_count} deleted, collection recreated")
        return prev_count
    
    @classmethod
    def health_check(cls) -> bool:
        try:
            cls._ensure_initialized()
            return cls._collection.count() >= 0
        except Exception as e:
            logger.error(f"ChromaDB health check failed: {e}")
            return False