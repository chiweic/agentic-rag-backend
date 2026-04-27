"""FastAPI application entry point."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.logging import get_logger, setup_logging

setup_logging()
log = get_logger(__name__)

from app.api.assisted_learning import router as assisted_learning_router  # noqa: E402
from app.api.chat import router as chat_router  # noqa: E402
from app.api.feedback import router as feedback_router  # noqa: E402
from app.api.openai_compat import router as openai_router  # noqa: E402
from app.api.quiz import router as quiz_router  # noqa: E402
from app.api.recommendations import router as recommendations_router  # noqa: E402
from app.api.sources import router as sources_router  # noqa: E402
from app.api.suggestions import router as suggestions_router  # noqa: E402
from app.api.threads import router as threads_router  # noqa: E402
from app.api.whats_new import router as whats_new_router  # noqa: E402
from app.core.auth import init_providers  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.tracing import shutdown_langfuse  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio

    from app.core.thread_store import close_store, init_store
    from app.news import build_news_feed, set_news_feed
    from app.rag import build_rag_service, set_rag_service
    from app.suggestions import StarterSuggestionsPool

    init_providers()

    # Build the RAG service once per process. Installed on a module-level
    # slot so request handlers can read it without FastAPI `Request`
    # dependency injection (keeps the route signatures clean).
    set_rag_service(build_rag_service(settings))
    log.info("RAG provider: %s", settings.rag_provider)

    # News feed for the 新鮮事 tab (features_v4.md §2). Same
    # module-level slot pattern as the RAG service; `static` default
    # works offline so CI and fresh devs aren't blocked on wiring up a
    # real news key.
    set_news_feed(build_news_feed(settings))
    log.info("News feed provider: %s", settings.news_feed_provider)

    # Starter suggestions pool — built in an asyncio background task so
    # startup isn't blocked on Milvus + LLM calls. The HTTP layer returns
    # 503 warming_up until `pool.status == "ready"`.
    pool = StarterSuggestionsPool(settings=settings)
    app.state.starter_pool = pool
    asyncio.create_task(pool.build())
    log.info("Starter suggestions pool: warming up in background")

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
                # Route shutdown through the store so we close whatever
                # connection it's currently holding (may have been reopened
                # after a dropped session) instead of the original handle.
                await close_store()
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


def _include_routers(app: FastAPI, settings) -> None:
    """Mount all routers. Dev-only routers are gated on `settings.auth_dev_mode`.

    Extracted so tests can verify gating against a fresh app + overridden
    Settings, instead of relying on process-wide env mutation.
    """
    app.include_router(chat_router)
    app.include_router(openai_router)
    app.include_router(threads_router)
    app.include_router(assisted_learning_router)
    app.include_router(suggestions_router)
    app.include_router(sources_router)
    app.include_router(quiz_router)
    app.include_router(feedback_router)
    app.include_router(recommendations_router)
    app.include_router(whats_new_router)

    if settings.auth_dev_mode:
        from app.api.auth_dev import router as auth_dev_router
        from app.api.suggestions import admin_router as suggestions_admin_router

        app.include_router(auth_dev_router)
        app.include_router(suggestions_admin_router)


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

_include_routers(app, settings)


@app.get("/health")
async def health():
    return {"status": "ok", "env": settings.app_env}
