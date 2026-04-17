from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env into os.environ FIRST — Langfuse SDK and other libs read env vars directly
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ---- RAG service -----------------------------------------------------
    # Selects the concrete RagService implementation (see app.rag).
    # "rag_bot" (default) wires retrieval + generation via the rag_bot
    # adapter. "null" falls back to a no-op service for boot without
    # retrieval.
    rag_provider: Literal["null", "rag_bot"] = "rag_bot"

    # Passed through to the selected provider. The provider decides how to
    # interpret them (e.g. rag_bot's DataSourceManager reads data_root as
    # a managed data directory).
    data_root: Path = Path("/mnt/data/rag_bot/data")
    default_source_type: str = "faguquanji"
    retrieval_backend: Literal["lexical", "milvus"] = "milvus"
    retrieval_limit: int = 5
    rerank_enabled: bool = False

    # Embedding service (TEI). Only used when retrieval_backend=milvus.
    embedding_base_url: str = "http://localhost:8080"
    embedding_truncate: bool = True

    # Milvus vector store. Only used when retrieval_backend=milvus.
    milvus_host: str = "localhost"
    milvus_port: int = 19530
    milvus_db_name: str = "langchain_demo"
    milvus_collection_prefix: str = "rag_bot"
    milvus_user: str = ""
    milvus_password: str = ""
    milvus_token: str = ""
    milvus_secure: bool = False
    milvus_timeout: float = 30.0

    # Rerank service. Only used when rerank_enabled=true.
    rerank_endpoint: str = "http://localhost:8081/rerank"
    rerank_top_n: int = 5
    rerank_candidate_k: int = 10
    rerank_batch_size: int = 64
    rerank_timeout: float = 120.0
    rerank_truncate_chars: int = 0

    # Langfuse (SDK reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY,
    # LANGFUSE_BASE_URL directly from env — these are here for validation only)
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "http://localhost:3002"

    # Postgres (thread checkpointer)
    postgres_uri: str = ""

    # Conversation limits
    max_message_window: int = 20  # messages sent to LLM (full history stays in DB)
    max_threads_per_user: int = 100  # 0 = unlimited

    # App
    app_env: str = "development"
    log_level: str = "info"

    # Auth
    google_oidc_client_id: str = ""
    google_oidc_issuer: str = "https://accounts.google.com"
    google_oidc_jwks_url: str = "https://www.googleapis.com/oauth2/v3/certs"
    auth_jwks_cache_ttl_seconds: int = 3600
    auth_allowed_clock_skew_seconds: int = 30
    # Logto OSS (self-hosted OIDC)
    logto_oidc_issuer: str = ""
    logto_oidc_jwks_url: str = ""
    logto_oidc_audience: str = ""

    # Dev-only auth bypass for Playwright / integration testing.
    # When True, a fresh RSA keypair is generated at startup and POST /auth/dev-token
    # is exposed. Must be False in production.
    auth_dev_mode: bool = False
    auth_dev_issuer: str = "https://dev.local"


settings = Settings()
