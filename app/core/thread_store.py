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

import json
import time
import uuid
from typing import TYPE_CHECKING

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

# Module-level backend — set once during startup
_conn: AsyncConnection | None = None
_memory: dict[str, dict] | None = None


async def init_store(conn: AsyncConnection | None = None) -> list[str]:
    """Initialise the store.

    With *conn*: Postgres-backed (creates table if needed).
    Without *conn*: in-memory dict (for tests).
    """
    global _conn, _memory
    purged_thread_ids: list[str] = []

    if conn is not None:
        _conn = conn
        _memory = None
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

        await conn.commit()
        log.info("Thread metadata store initialised (postgres)")
    else:
        _conn = None
        _memory = {}
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
        async with _conn.cursor() as cur:
            await cur.execute(
                "INSERT INTO thread_metadata"
                " (thread_id, user_id, title, created_at, is_archived, metadata)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                (thread_id, user_id, None, created_at, False, json.dumps(meta)),
            )
        await _conn.commit()

    log.info("Thread created: %s for user: %s", thread_id, user_id)
    return record


async def get_thread(thread_id: str) -> dict | None:
    _require_ready()

    if _is_memory():
        rec = _memory.get(thread_id)
        return rec.copy() if rec else None

    async with _conn.cursor() as cur:
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


async def list_threads(user_id: str, include_archived: bool = False) -> list[dict]:
    _require_ready()

    if _is_memory():
        items = [t.copy() for t in _memory.values() if t.get("user_id") == user_id]
        if not include_archived:
            items = [t for t in items if not t["is_archived"]]
        items.sort(key=lambda t: t["created_at"], reverse=True)
        return items

    query = (
        "SELECT thread_id, user_id, title, created_at, is_archived, metadata"
        " FROM thread_metadata WHERE user_id = %s"
    )
    if not include_archived:
        query += " AND is_archived = FALSE"
    query += " ORDER BY created_at DESC"

    async with _conn.cursor() as cur:
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

    async with _conn.cursor() as cur:
        await cur.execute(query, params)
        updated = cur.rowcount > 0
    await _conn.commit()

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

    async with _conn.cursor() as cur:
        await cur.execute(query, params)
        deleted = cur.rowcount > 0
    await _conn.commit()

    if deleted:
        log.info("Thread deleted: %s", thread_id)
    return deleted
