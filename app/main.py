"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.logging import get_logger, setup_logging

setup_logging()
log = get_logger(__name__)

from app.api.chat import router as chat_router
from app.api.openai_compat import router as openai_router
from app.api.threads import router as threads_router
from app.core.config import settings
from app.core.tracing import shutdown_langfuse


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize Postgres checkpointer
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    log.info("Starting up — connecting to Postgres at %s", settings.postgres_uri.split("@")[-1])
    async with AsyncPostgresSaver.from_conn_string(settings.postgres_uri) as checkpointer:
        await checkpointer.setup()
        from app.agent.graph import set_checkpointer
        set_checkpointer(checkpointer)
        log.info("Checkpointer ready — LangGraph agent initialized")
        yield

    log.info("Shutting down — flushing Langfuse")
    shutdown_langfuse()


app = FastAPI(
    title="Agentic RAG Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat_router)
app.include_router(openai_router)
app.include_router(threads_router)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}
