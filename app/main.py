"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.logging import get_logger, setup_logging

setup_logging()
log = get_logger(__name__)

from app.api.assisted_learning import router as assisted_learning_router  # noqa: E402
from app.api.chat import router as chat_router  # noqa: E402
from app.api.openai_compat import router as openai_router  # noqa: E402
from app.api.threads import router as threads_router  # noqa: E402
from app.core.auth import init_providers  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.tracing import shutdown_langfuse  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.core.thread_store import init_store

    init_providers()

    if settings.postgres_uri:
        # Production: Postgres-backed checkpointer + thread store
        # Use a connection pool so concurrent requests don't collide on a
        # single AsyncConnection ("another command is already in progress").
        from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
        from psycopg import AsyncConnection
        from psycopg.rows import dict_row
        from psycopg_pool import AsyncConnectionPool

        log.info(
            "Starting up — connecting to Postgres at %s",
            settings.postgres_uri.split("@")[-1],
        )
        async with AsyncConnectionPool(
            conninfo=settings.postgres_uri,
            min_size=2,
            max_size=10,
            kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        ) as pool:
            checkpointer = AsyncPostgresSaver(conn=pool)
            await checkpointer.setup()
            from app.agent.graph import set_checkpointer

            set_checkpointer(checkpointer)
            log.info("Checkpointer ready — LangGraph agent initialized (pooled)")

            conn = await AsyncConnection.connect(settings.postgres_uri, autocommit=False)
            purged_thread_ids = await init_store(conn)
            if purged_thread_ids:
                for thread_id in purged_thread_ids:
                    await checkpointer.adelete_thread(thread_id)
                log.info(
                    "Deleted checkpoint state for %d anonymous threads during ownership migration",
                    len(purged_thread_ids),
                )
            log.info("Thread metadata store ready")

            try:
                yield
            finally:
                await conn.close()
    else:
        # CI / test: in-memory backends (no Postgres required)
        from langgraph.checkpoint.memory import MemorySaver

        from app.agent.graph import set_checkpointer

        set_checkpointer(MemorySaver())
        await init_store()
        log.info("Starting up — in-memory backends (no Postgres)")
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
app.include_router(assisted_learning_router)

if settings.auth_dev_mode:
    from app.api.auth_dev import router as auth_dev_router

    app.include_router(auth_dev_router)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}
