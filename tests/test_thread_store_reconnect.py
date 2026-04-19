"""Tests for `thread_store._ensure_connection` reopen + lock behavior.

These use a minimal async fake rather than a real Postgres because we're
exercising the module's bookkeeping, not SQL. A real-Postgres integration
test would need infra and wouldn't catch the race we're guarding against
any more reliably than this.
"""

from __future__ import annotations

import asyncio

import pytest

from app.core import thread_store


class _FakeConnection:
    """Minimal stand-in for psycopg's AsyncConnection.

    Tracks `.closed` so the store can decide whether to reopen, and
    records that close() was called.
    """

    def __init__(self) -> None:
        self.closed: bool = False
        self.close_calls: int = 0

    async def close(self) -> None:
        self.closed = True
        self.close_calls += 1


@pytest.fixture(autouse=True)
def _reset_module_state():
    """Reset thread_store's global state around each test.

    The autouse conftest fixture installs an in-memory store; these tests
    want to drive the Postgres-ish code path directly, so we wipe state
    before and after each test.
    """
    thread_store._conn = None
    thread_store._memory = None
    thread_store._reopen_lock = None
    yield
    thread_store._conn = None
    thread_store._memory = None
    thread_store._reopen_lock = None


@pytest.mark.asyncio
async def test_ensure_connection_returns_live_conn_unchanged():
    fake = _FakeConnection()
    thread_store._conn = fake  # type: ignore[assignment]

    returned = await thread_store._ensure_connection()

    assert returned is fake
    assert fake.close_calls == 0


@pytest.mark.asyncio
async def test_ensure_connection_raises_when_uninitialised():
    with pytest.raises(RuntimeError, match="not initialised"):
        await thread_store._ensure_connection()


@pytest.mark.asyncio
async def test_ensure_connection_raises_when_closed_without_postgres_uri(
    monkeypatch,
):
    fake = _FakeConnection()
    fake.closed = True
    thread_store._conn = fake  # type: ignore[assignment]

    monkeypatch.setattr(thread_store.settings, "postgres_uri", "")

    with pytest.raises(RuntimeError, match="POSTGRES_URI is unset"):
        await thread_store._ensure_connection()


@pytest.mark.asyncio
async def test_ensure_connection_reopens_on_closed(monkeypatch):
    """A closed connection triggers exactly one reopen."""
    stale = _FakeConnection()
    stale.closed = True
    thread_store._conn = stale  # type: ignore[assignment]
    monkeypatch.setattr(thread_store.settings, "postgres_uri", "postgresql://x")

    fresh = _FakeConnection()
    connect_calls: list[str] = []

    class _AsyncConnectionStub:
        @staticmethod
        async def connect(uri, autocommit=False):
            connect_calls.append(uri)
            return fresh

    # The reopen imports psycopg.AsyncConnection locally; patch the module.
    import psycopg

    monkeypatch.setattr(psycopg, "AsyncConnection", _AsyncConnectionStub)

    returned = await thread_store._ensure_connection()

    assert returned is fresh
    assert thread_store._conn is fresh
    assert connect_calls == ["postgresql://x"]


@pytest.mark.asyncio
async def test_concurrent_reopen_only_connects_once(monkeypatch):
    """N concurrent CRUD callers on a dead connection → 1 reconnect, not N."""
    stale = _FakeConnection()
    stale.closed = True
    thread_store._conn = stale  # type: ignore[assignment]
    monkeypatch.setattr(thread_store.settings, "postgres_uri", "postgresql://x")

    fresh = _FakeConnection()
    connect_calls: list[str] = []

    class _AsyncConnectionStub:
        @staticmethod
        async def connect(uri, autocommit=False):
            # Yield once so a second caller can enter _ensure_connection
            # and observe the (still-closed) stale conn before we swap it.
            await asyncio.sleep(0)
            connect_calls.append(uri)
            return fresh

    import psycopg

    monkeypatch.setattr(psycopg, "AsyncConnection", _AsyncConnectionStub)

    results = await asyncio.gather(
        thread_store._ensure_connection(),
        thread_store._ensure_connection(),
        thread_store._ensure_connection(),
        thread_store._ensure_connection(),
        thread_store._ensure_connection(),
    )

    assert all(r is fresh for r in results)
    assert len(connect_calls) == 1


@pytest.mark.asyncio
async def test_close_store_is_idempotent():
    fake = _FakeConnection()
    thread_store._conn = fake  # type: ignore[assignment]

    await thread_store.close_store()
    assert fake.close_calls == 1
    assert thread_store._conn is None

    # Second call shouldn't explode.
    await thread_store.close_store()
    assert fake.close_calls == 1


@pytest.mark.asyncio
async def test_close_store_closes_reopened_conn_not_original(monkeypatch):
    """Shutdown must close the reconnected conn, not the stale original."""
    stale = _FakeConnection()
    stale.closed = True
    thread_store._conn = stale  # type: ignore[assignment]
    monkeypatch.setattr(thread_store.settings, "postgres_uri", "postgresql://x")

    fresh = _FakeConnection()

    class _AsyncConnectionStub:
        @staticmethod
        async def connect(uri, autocommit=False):
            return fresh

    import psycopg

    monkeypatch.setattr(psycopg, "AsyncConnection", _AsyncConnectionStub)

    # Reopen happens here.
    await thread_store._ensure_connection()
    assert thread_store._conn is fresh

    # close_store() should close `fresh`, the current live conn.
    await thread_store.close_store()
    assert fresh.close_calls == 1
    # `stale` was already closed when it went stale; we don't touch it.
    assert stale.close_calls == 0
