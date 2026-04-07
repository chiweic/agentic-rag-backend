from pathlib import Path

from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env into os.environ FIRST — Langfuse SDK and other libs read env vars directly
load_dotenv(Path(__file__).resolve().parents[2] / ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # LLM (OpenAI-compatible endpoint)
    openai_api_base: str = "http://area51r5:8003/v1"
    openai_api_key: str = "not-needed"
    openai_model: str = "gpt-4o-mini"

    # Langfuse (SDK reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY,
    # LANGFUSE_BASE_URL directly from env — these are here for validation only)
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "http://localhost:3002"

    # Postgres (thread checkpointer)
    postgres_uri: str = "postgresql://langgraph:langgraph@localhost:5434/langgraph"

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
    clerk_oidc_issuer: str = ""
    clerk_oidc_jwks_url: str = ""
    clerk_authorized_parties: str = ""

    # Dev-only auth bypass for Playwright / integration testing.
    # When True, a fresh RSA keypair is generated at startup and POST /auth/dev-token
    # is exposed. Must be False in production.
    auth_dev_mode: bool = False
    auth_dev_issuer: str = "https://dev.local"


settings = Settings()
