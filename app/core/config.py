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


settings = Settings()
