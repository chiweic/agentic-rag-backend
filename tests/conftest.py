"""Shared test fixtures.

Uses MemorySaver and in-memory thread store so tests run without external services.
"""

import pytest
from httpx import ASGITransport, AsyncClient
from langgraph.checkpoint.memory import MemorySaver

from app.agent.graph import set_checkpointer
from app.core import thread_store
from app.core.auth import UserClaims, get_current_user
from app.main import app


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


@pytest.fixture(autouse=True)
async def _setup_backends():
    """Inject in-memory checkpointer and thread store for all tests."""
    set_checkpointer(MemorySaver())
    await thread_store.init_store()  # no conn → in-memory
    yield


@pytest.fixture
async def client():
    """Async HTTP client that talks directly to the FastAPI app."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
