"""Shared test fixtures.

Uses MemorySaver and in-memory thread store so tests run without external services.
A fake `RagService` is injected on `app.state` so graph nodes can run without
hitting real retrieval or an LLM endpoint.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import MemorySaver

from app.agent.graph import set_checkpointer
from app.core import thread_store
from app.core.auth import UserClaims, get_current_user
from app.core.config import settings
from app.main import app
from app.news import set_news_feed
from app.news.providers._static import StaticSampleFeed
from app.rag import set_rag_service
from app.rag.protocol import RagAnswer, RagService, RetrievalHit
from app.suggestions.starter import StarterSuggestionsPool


class FakeRagService:
    """Deterministic `RagService` for tests — no LLM, no network.

    `search` returns a fixed pair of hits with marker text so assertions
    can verify the retrieve node populated state correctly.
    `generate` returns the last user message prefixed with a marker so
    assertions can verify the generate node was reached.

    Captures calls on `.search_calls` / `.generate_calls` so tests can
    assert how many times each node ran.
    """

    MARKER = "FIXTURE_RAG_ANSWER"

    def __init__(self) -> None:
        self.search_calls: list[dict] = []
        self.generate_calls: list[dict] = []
        self.record_chunks_calls: list[dict] = []

    def search(
        self,
        query: str,
        *,
        source_type: str | None = None,
        limit: int = 5,
    ) -> list[RetrievalHit]:
        self.search_calls.append({"query": query, "source_type": source_type, "limit": limit})
        return [
            RetrievalHit(
                chunk_id="FIXTURE_CHUNK_0",
                text="fixture chunk text 0",
                title="FIXTURE_DOC_A",
                source_url="https://example.test/a",
                score=0.9,
                metadata={"source_type": source_type or "faguquanji"},
            ),
            RetrievalHit(
                chunk_id="FIXTURE_CHUNK_1",
                text="fixture chunk text 1",
                title="FIXTURE_DOC_B",
                source_url="https://example.test/b",
                score=0.8,
                metadata={"source_type": source_type or "faguquanji"},
            ),
        ]

    def get_record_chunks(
        self,
        record_id: str,
        *,
        source_type: str,
    ) -> list[RetrievalHit]:
        self.record_chunks_calls.append({"record_id": record_id, "source_type": source_type})
        return [
            RetrievalHit(
                chunk_id=f"FIXTURE_RECORD_CHUNK_{idx}",
                text=f"record chunk {idx}",
                title="FIXTURE_RECORD_TITLE",
                source_url=f"https://example.test/{record_id}",
                score=None,
                metadata={
                    "source_type": source_type,
                    "record_id": record_id,
                    "chunk_index": idx,
                },
            )
            for idx in range(2)
        ]

    def generate(
        self,
        query: str,
        hits: list[RetrievalHit],
        *,
        history: list[dict[str, str]] | None = None,
        scope_record_id: str | None = None,
        variant: str | None = None,
    ) -> RagAnswer:
        self.generate_calls.append(
            {
                "query": query,
                "hit_count": len(hits),
                "history": history,
                "scope_record_id": scope_record_id,
                "variant": variant,
            }
        )
        return RagAnswer(
            text=f"{self.MARKER} for query: {query}",
            citations=hits,
        )


# Runtime-protocol check.
_: RagService = FakeRagService()


@pytest.fixture(autouse=True)
def mock_auth():
    """Override get_current_user for all tests by default."""
    app.dependency_overrides[get_current_user] = lambda: UserClaims(
        sub="test-user-sub",
        email="test@example.com",
        email_verified=True,
        name="Test User",
        picture=None,
        iss="https://accounts.google.com",
        aud="test-aud",
        exp=9999999999,
    )
    yield
    app.dependency_overrides.clear()


_FAKE: FakeRagService | None = None


_FIXTURE_STARTER_TITLES = [
    "What is zen?",
    "How to start meditating?",
    "What is the Diamond Sutra?",
    "Why do we chant?",
    "What is karma?",
]


def _fake_rephraser(titles: list[str]) -> list[str]:
    return [f"Tell me about {t.rstrip('?')}" for t in titles]


@pytest.fixture(autouse=True)
async def _setup_backends():
    """Inject in-memory checkpointer, thread store, fake RAG, and fake starter pool."""
    global _FAKE
    set_checkpointer(MemorySaver())
    await thread_store.init_store()  # no conn → in-memory
    _FAKE = FakeRagService()
    set_rag_service(_FAKE)

    pool = StarterSuggestionsPool(
        settings=settings,
        title_source=lambda: list(_FIXTURE_STARTER_TITLES),
        rephraser=_fake_rephraser,
    )
    await pool.build()
    app.state.starter_pool = pool

    # The 新鮮事 tab reads current_news_feed(); install the static
    # sample feed so /whats-new-suggestions has something to return
    # under test (no network).
    set_news_feed(StaticSampleFeed())

    yield

    set_rag_service(None)
    set_news_feed(None)
    _FAKE = None
    app.state.starter_pool = None


@pytest.fixture
def fake_rag_service() -> FakeRagService:
    """Direct handle to the fake service installed for the current test.

    Usage in tests:
        async def test_something(fake_rag_service, client):
            ...
            assert len(fake_rag_service.search_calls) == 1
    """
    assert _FAKE is not None, "fake_rag_service not installed; check conftest fixture order"
    return _FAKE


@pytest.fixture
async def client():
    """Async HTTP client that talks directly to the FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
