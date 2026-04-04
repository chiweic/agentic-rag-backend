"""Shared test fixtures.

Uses MemorySaver instead of Postgres so tests run without external services.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import MemorySaver

from app.agent.graph import set_checkpointer
from app.main import app


@pytest.fixture(autouse=True)
def _setup_checkpointer():
    """Inject in-memory checkpointer for all tests."""
    set_checkpointer(MemorySaver())
    yield


@pytest.fixture
async def client():
    """Async HTTP client that talks directly to the FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
