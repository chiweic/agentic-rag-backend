"""Thread metadata store — Postgres-backed (production) or in-memory (tests).

Persists thread metadata (title, created_at, is_archived, custom metadata)
so it survives server restarts.

Usage:
    # Production — pass a psycopg AsyncConnection
    await init_store(conn)

    # Tests — no arguments, uses in-memory dict
    await init_store()
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from typing import TYPE_CHECKING

from app.core.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from psycopg import AsyncConnection

log = get_logger(__name__)

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS thread_metadata (
    thread_id   TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    title       TEXT,
    created_at  DOUBLE PRECISION NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb
);
"""

_CREATE_USER_CREATED_INDEX = """
CREATE INDEX IF NOT EXISTS thread_metadata_user_created_idx
ON thread_metadata (user_id, created_at DESC);
"""

# Thumbs-up/down feedback per assistant message. Keyed on (thread,
# message, user) so one user's reaction is independent of another's
# on the same shared message, and so re-clicking replaces the prior
# value instead of accumulating rows.
_CREATE_FEEDBACK_TABLE = """
CREATE TABLE IF NOT EXISTS message_feedback (
    thread_id   TEXT NOT NULL,
    message_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    feedback    TEXT NOT NULL CHECK (feedback IN ('positive', 'negative')),
    created_at  DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (thread_id, message_id, user_id)
);
"""

# Module-level backend — set once during startup
_conn: AsyncConnection | None = None
_memory: dict[str, dict] | None = None
_feedback_memory: dict[tuple[str, str, str], str] | None = None

# Guards reopen so concurrent CRUD calls only reconnect once when the
# shared Postgres connection goes stale (timeout, server restart).
_reopen_lock: asyncio.Lock | None = None


async def _ensure_connection() -> AsyncConnection:
    """Return the live Postgres connection, reopening if it was closed.

    The shared single-connection pattern can drop in production when the
    server disconnects idle sessions. Rather than crashing the request,
    we reopen once — guarded by a lock so N concurrent callers produce
    exactly one reconnect, not N.
    """
    global _conn, _reopen_lock

    if _conn is None:
        raise RuntimeError("Thread store not initialised — call init_store() first")

    if not getattr(_conn, "closed", False):
        return _conn

    if not settings.postgres_uri:
        raise RuntimeError(
            "Thread store connection is closed and POSTGRES_URI is unset — " "cannot reopen"
        )

    if _reopen_lock is None:
        _reopen_lock = asyncio.Lock()

    async with _reopen_lock:
        # Re-check under the lock — another coroutine may have already
        # reopened while we were waiting.
        if _conn is not None and not getattr(_conn, "closed", False):
            return _conn

        from psycopg import AsyncConnection as _AsyncConnection

        log.warning("Thread store connection was closed; reopening Postgres connection")
        _conn = await _AsyncConnection.connect(settings.postgres_uri, autocommit=False)
        return _conn


async def close_store() -> None:
    """Close the active Postgres connection. Safe to call multiple times.

    Lifespan calls this on shutdown. Goes through the module-level `_conn`
    so it closes whatever connection `_ensure_connection` reopened, not
    the one originally handed to `init_store`.
    """
    global _conn
    if _conn is not None and not getattr(_conn, "closed", False):
        await _conn.close()
    _conn = None


async def init_store(conn: AsyncConnection | None = None) -> list[str]:
    """Initialise the store.

    With *conn*: Postgres-backed (creates table if needed).
    Without *conn*: in-memory dict (for tests).
    """
    global _conn, _memory, _feedback_memory
    purged_thread_ids: list[str] = []

    if conn is not None:
        _conn = conn
        _memory = None
        _feedback_memory = None
        async with conn.cursor() as cur:
            await cur.execute(_CREATE_TABLE)

            await cur.execute("ALTER TABLE thread_metadata ADD COLUMN IF NOT EXISTS user_id TEXT")
            await cur.execute("SELECT thread_id FROM thread_metadata WHERE user_id IS NULL")
            purged_thread_ids = [row[0] for row in await cur.fetchall()]
            if purged_thread_ids:
                log.info(
                    "Migrating thread_metadata: deleting %d anonymous thread rows",
                    len(purged_thread_ids),
                )
                await cur.execute("DELETE FROM thread_metadata WHERE user_id IS NULL")

            await cur.execute("ALTER TABLE thread_metadata ALTER COLUMN user_id SET NOT NULL")
            await cur.execute(_CREATE_USER_CREATED_INDEX)
            await cur.execute(_CREATE_FEEDBACK_TABLE)

        await conn.commit()
        log.info("Thread metadata store initialised (postgres)")
    else:
        _conn = None
        _memory = {}
        _feedback_memory = {}
        log.info("Thread metadata store initialised (memory)")

    return purged_thread_ids


def _is_memory() -> bool:
    return _memory is not None


def _require_ready() -> None:
    if _conn is None and _memory is None:
        raise RuntimeError("Thread store not initialised — call init_store() first")


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------


async def create_thread(user_id: str, metadata: dict | None = None) -> dict:
    _require_ready()
    thread_id = str(uuid.uuid4())
    created_at = time.time()
    meta = metadata or {}

    record = {
        "thread_id": thread_id,
        "user_id": user_id,
        "title": None,
        "created_at": created_at,
        "is_archived": False,
        "metadata": meta,
    }

    if _is_memory():
        _memory[thread_id] = record.copy()
    else:
        conn = await _ensure_connection()
        async with conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO thread_metadata"
                " (thread_id, user_id, title, created_at, is_archived, metadata)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                (thread_id, user_id, None, created_at, False, json.dumps(meta)),
            )
        await conn.commit()

    log.info("Thread created: %s for user: %s", thread_id, user_id)
    return record


async def get_thread(thread_id: str) -> dict | None:
    _require_ready()

    if _is_memory():
        rec = _memory.get(thread_id)
        return rec.copy() if rec else None

    conn = await _ensure_connection()
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT thread_id, user_id, title, created_at, is_archived, metadata "
            "FROM thread_metadata WHERE thread_id = %s",
            (thread_id,),
        )
        row = await cur.fetchone()

    if row is None:
        return None

    return {
        "thread_id": row[0],
        "user_id": row[1],
        "title": row[2],
        "created_at": row[3],
        "is_archived": row[4],
        "metadata": row[5] if isinstance(row[5], dict) else json.loads(row[5]),
    }


async def list_threads(
    user_id: str,
    include_archived: bool = False,
    include_deep_dive: bool = False,
) -> list[dict]:
    """List threads owned by `user_id`.

    Deep-dive threads (metadata.deep_dive == True) are hidden by default
    because they're ephemeral research contexts anchored to a parent
    thread, not first-class conversations. Pass `include_deep_dive=True`
    to see them in a future "research history" view.
    """
    _require_ready()

    def _is_deep_dive(meta: dict | None) -> bool:
        return bool(meta and meta.get("deep_dive"))

    if _is_memory():
        items = [t.copy() for t in _memory.values() if t.get("user_id") == user_id]
        if not include_archived:
            items = [t for t in items if not t["is_archived"]]
        if not include_deep_dive:
            items = [t for t in items if not _is_deep_dive(t.get("metadata"))]
        items.sort(key=lambda t: t["created_at"], reverse=True)
        return items

    query = (
        "SELECT thread_id, user_id, title, created_at, is_archived, metadata"
        " FROM thread_metadata WHERE user_id = %s"
    )
    if not include_archived:
        query += " AND is_archived = FALSE"
    # Postgres JSONB deep-dive filter — cheap since thread_metadata
    # already has a user_id index covering the common case.
    if not include_deep_dive:
        query += " AND (metadata->>'deep_dive' IS NULL OR metadata->>'deep_dive' = 'false')"
    query += " ORDER BY created_at DESC"

    conn = await _ensure_connection()
    async with conn.cursor() as cur:
        await cur.execute(query, (user_id,))
        rows = await cur.fetchall()

    return [
        {
            "thread_id": r[0],
            "user_id": r[1],
            "title": r[2],
            "created_at": r[3],
            "is_archived": r[4],
            "metadata": r[5] if isinstance(r[5], dict) else json.loads(r[5]),
        }
        for r in rows
    ]


async def update_thread(
    thread_id: str,
    *,
    user_id: str | None = None,
    title: str | None = ...,
    is_archived: bool | None = ...,
    metadata: dict | None = ...,
) -> dict | None:
    """Update thread fields. Only provided (non-sentinel) fields are changed."""
    _require_ready()

    if _is_memory():
        rec = _memory.get(thread_id)
        if rec is None or (user_id is not None and rec.get("user_id") != user_id):
            return None
        if title is not ...:
            rec["title"] = title
        if is_archived is not ...:
            rec["is_archived"] = is_archived
        if metadata is not ...:
            rec["metadata"] = metadata if metadata is not None else {}
        return rec.copy()

    sets: list[str] = []
    params: list = []

    if title is not ...:
        sets.append("title = %s")
        params.append(title)
    if is_archived is not ...:
        sets.append("is_archived = %s")
        params.append(is_archived)
    if metadata is not ...:
        sets.append("metadata = %s")
        params.append(json.dumps(metadata) if metadata is not None else "{}")

    if not sets:
        record = await get_thread(thread_id)
        if record is None or (user_id is not None and record.get("user_id") != user_id):
            return None
        return record

    query = f"UPDATE thread_metadata SET {', '.join(sets)} WHERE thread_id = %s"
    params.append(thread_id)
    if user_id is not None:
        query += " AND user_id = %s"
        params.append(user_id)

    conn = await _ensure_connection()
    async with conn.cursor() as cur:
        await cur.execute(query, params)
        updated = cur.rowcount > 0
    await conn.commit()

    if not updated:
        return None

    record = await get_thread(thread_id)
    if record is None or (user_id is not None and record.get("user_id") != user_id):
        return None
    return record


async def delete_thread(thread_id: str, *, user_id: str | None = None) -> bool:
    _require_ready()

    if _is_memory():
        rec = _memory.get(thread_id)
        deleted = rec is not None and (user_id is None or rec.get("user_id") == user_id)
        if deleted:
            _memory.pop(thread_id, None)
        if deleted:
            log.info("Thread deleted: %s", thread_id)
        return deleted

    query = "DELETE FROM thread_metadata WHERE thread_id = %s"
    params: list = [thread_id]
    if user_id is not None:
        query += " AND user_id = %s"
        params.append(user_id)

    conn = await _ensure_connection()
    async with conn.cursor() as cur:
        await cur.execute(query, params)
        deleted = cur.rowcount > 0
    await conn.commit()

    if deleted:
        log.info("Thread deleted: %s", thread_id)
    return deleted


# ---------------------------------------------------------------------------
# Message feedback (thumbs up/down)
# ---------------------------------------------------------------------------


async def set_feedback(
    thread_id: str,
    message_id: str,
    user_id: str,
    feedback: str,
) -> None:
    """Upsert a thumbs-up/down reaction for a (thread, message, user) triple.

    Re-calling with a different value replaces the prior one; a third
    value is rejected at the SQL CHECK constraint, so validation should
    happen at the API boundary.
    """
    _require_ready()

    if _is_memory():
        assert _feedback_memory is not None
        _feedback_memory[(thread_id, message_id, user_id)] = feedback
        return

    conn = await _ensure_connection()
    async with conn.cursor() as cur:
        await cur.execute(
            "INSERT INTO message_feedback"
            " (thread_id, message_id, user_id, feedback, created_at)"
            " VALUES (%s, %s, %s, %s, %s)"
            " ON CONFLICT (thread_id, message_id, user_id)"
            " DO UPDATE SET feedback = EXCLUDED.feedback,"
            "               created_at = EXCLUDED.created_at",
            (thread_id, message_id, user_id, feedback, time.time()),
        )
    await conn.commit()


async def clear_feedback(thread_id: str, message_id: str, user_id: str) -> bool:
    """Remove the reaction for a (thread, message, user) triple.

    Returns True if a row was deleted, False if none existed. Used when
    the user clicks the same thumb again to un-rate the message.
    """
    _require_ready()

    if _is_memory():
        assert _feedback_memory is not None
        return _feedback_memory.pop((thread_id, message_id, user_id), None) is not None

    conn = await _ensure_connection()
    async with conn.cursor() as cur:
        await cur.execute(
            "DELETE FROM message_feedback"
            " WHERE thread_id = %s AND message_id = %s AND user_id = %s",
            (thread_id, message_id, user_id),
        )
        deleted = cur.rowcount > 0
    await conn.commit()
    return deleted


async def get_feedback(
    thread_id: str,
    message_id: str,
    user_id: str,
) -> str | None:
    """Return the user's reaction for the given message, or None."""
    _require_ready()

    if _is_memory():
        assert _feedback_memory is not None
        return _feedback_memory.get((thread_id, message_id, user_id))

    conn = await _ensure_connection()
    async with conn.cursor() as cur:
        await cur.execute(
            "SELECT feedback FROM message_feedback"
            " WHERE thread_id = %s AND message_id = %s AND user_id = %s",
            (thread_id, message_id, user_id),
        )
        row = await cur.fetchone()
    return row[0] if row else None
