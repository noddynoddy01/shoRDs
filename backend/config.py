import os
from pydantic import BaseModel

class Settings(BaseModel):
    APP_NAME: str = "shoRDs Federated Research Backend"
    VERSION: str = "2.0.0"
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")

    # Storage & DB
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://shords:shords_pass@localhost:5432/shords_db")
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    
    # Dedicated Vector Database (Qdrant)
    VECTOR_DB_TYPE: str = os.getenv("VECTOR_DB_TYPE", "qdrant")
    QDRANT_HOST: str = os.getenv("QDRANT_HOST", "localhost")
    QDRANT_PORT: int = int(os.getenv("QDRANT_PORT", "6333"))
    QDRANT_API_KEY: str = os.getenv("QDRANT_API_KEY", "")
    VECTOR_COLLECTION_NAME: str = os.getenv("VECTOR_COLLECTION_NAME", "shords_paper_embeddings")

    # Cloud Multi-Voice Audio API
    AUDIO_API_PROVIDER: str = os.getenv("AUDIO_API_PROVIDER", "openai")  # openai or elevenlabs
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    ELEVENLABS_API_KEY: str = os.getenv("ELEVENLABS_API_KEY", "")

    # Object Storage (S3 / MinIO)
    S3_ENDPOINT: str = os.getenv("S3_ENDPOINT", "http://localhost:9000")
    S3_ACCESS_KEY: str = os.getenv("S3_ACCESS_KEY", "minioadmin")
    S3_SECRET_KEY: str = os.getenv("S3_SECRET_KEY", "minioadmin")
    S3_BUCKET_NAME: str = os.getenv("S3_BUCKET_NAME", "shords-assets")

    # Rate Limiting & User Agent
    POLITE_USER_AGENT: str = os.getenv("POLITE_USER_AGENT", "shoRDs-Bot/2.0 (https://shords.app; mailto:support@shords.app)")

settings = Settings()
