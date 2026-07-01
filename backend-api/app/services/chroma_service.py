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

import chromadb
from chromadb.config import Settings as ChromaSettings
from chromadb.api.models.Collection import Collection

from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class SearchResult:
    "Result from a 1:N vector search."
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
    - Distance threshold (0.4) tuned for ArcFace/MobileFaceNet cosine distance
    - Cosine distance: lower = more similar. 0.4 is conservative threshold
      (ArcFace typically achieves <0.3 for genuine matches, >0.6 for impostors)
    """
    
    _client: Optional[chromadb.HttpClient] = None
    _collection: Optional[Collection] = None
    
    @classmethod
    def initialize(cls) -> None:
        "Initialize ChromaDB client and get/create collection on startup."
        if cls._client is not None:
            logger.warning("ChromaDB client already initialized")
            return
        
        try:
            cls._client = chromadb.HttpClient(
                host=settings.chroma_host,
                port=settings.chroma_port,
                settings=ChromaSettings(
                    anonymized_telemetry=False,
                    allow_reset=True,
                ),
            )
            
            # Get or create collection for face embeddings
            # HNSW index is created automatically on first add
            cls._collection = cls._client.get_or_create_collection(
                name=settings.chroma_collection_name,
                metadata={"hnsw:space": "cosine"},  # Cosine similarity for face embeddings
            )
            
            logger.info(
                f"ChromaDB initialized: host={settings.chroma_host}:{settings.chroma_port}, "
                f"collection={settings.chroma_collection_name}, "
                f"count={cls._collection.count()}"
            )
        except Exception as e:
            logger.error(f"Failed to initialize ChromaDB: {e}")
            raise
    
    @classmethod
    def close(cls) -> None:
        "Close ChromaDB client connections."
        cls._client = None
        cls._collection = None
        logger.info("ChromaDB client closed")
    
    @classmethod
    def _ensure_initialized(cls) -> None:
        "Ensure client and collection are initialized and exist on the server."
        if cls._client is None or cls._collection is None:
            raise RuntimeError("ChromaDB not initialized. Call initialize() first.")
        try:
            cls._collection = cls._client.get_collection(name=settings.chroma_collection_name)
        except Exception:
            logger.warning("ChromaDB collection missing on server, recreating...")
            cls._collection = cls._client.get_or_create_collection(
                name=settings.chroma_collection_name,
                metadata={"hnsw:space": "cosine"},
            )
    
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
            embedding: 512-dim normalized face embedding from ArcFace
            
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
        Perform 1:N cosine similarity search for the nearest face match.
        
        Why n_results=1?
        - Verification only needs the single best match
        - Top-1 is sufficient for 1:1 verification (user claims identity)
        - For identification (1:N without claim), increase n_results
        
        Returns:
            SearchResult with user_id, distance, and embedding if found, None otherwise
        """
        cls._ensure_initialized()
        
        try:
            results = cls._collection.query(
                query_embeddings=[embedding],
                n_results=n_results,
                include=["embeddings", "distances", "metadatas"],
            )
            
            if not results["ids"] or not results["ids"][0]:
                return None
            
            best_id = results["ids"][0][0]
            best_distance = results["distances"][0][0]
            best_embedding = results["embeddings"][0][0]
            
            return SearchResult(
                user_id=best_id,
                distance=best_distance,
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
            # Check if exists first (ChromaDB delete is idempotent but we want to know)
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
        "Retrieve a user's embedding (for debugging/admin)."
        cls._ensure_initialized()
        
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
        "Get total number of embeddings in the collection."
        cls._ensure_initialized()
        return cls._collection.count()
    
    @classmethod
    def reset_collection(cls) -> int:
        """
        Drop and recreate the face_embeddings collection to clear all vectors.
        
        Returns:
            Number of embeddings that were removed
        """
        cls._ensure_initialized()

        count_before = cls._collection.count()
        cls._client.delete_collection(settings.chroma_collection_name)
        cls._collection = cls._client.create_collection(
            name=settings.chroma_collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        logger.info(
            f"ChromaDB collection reset: removed {count_before} embeddings, "
            f"created new empty collection"
        )
        return count_before
    
    @classmethod
    def health_check(cls) -> bool:
        "Health check for readiness/liveness probes."
        try:
            cls._ensure_initialized()
            cls._client.list_collections()
            return True
        except Exception as e:
            logger.error(f"ChromaDB health check failed: {e}")
            return False
