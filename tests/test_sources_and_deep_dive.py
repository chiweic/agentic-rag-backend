"""Tests for GET /sources/{source_type}/{record_id} and deep-dive thread filtering."""

from __future__ import annotations

import pytest


# ---------------------------------------------------------------------------
# GET /sources/{source_type}/{record_id}
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_get_source_returns_concatenatable_chunks(client, fake_rag_service):
    """Endpoint returns the full record in chunk_index order + record-level meta."""
    resp = await client.get("/sources/faguquanji/REC-XYZ")
    assert resp.status_code == 200
    body = resp.json()

    assert body["record_id"] == "REC-XYZ"
    assert body["source_type"] == "faguquanji"
    assert body["title"] == "FIXTURE_RECORD_TITLE"
    assert len(body["chunks"]) == 2
    # Fake returns two chunks; chunk_index order preserved.
    assert [c["metadata"]["chunk_index"] for c in body["chunks"]] == [0, 1]

    # The fake reported the call with our URL params — proves source_type
    # + record_id plumbed through correctly.
    assert fake_rag_service.record_chunks_calls[-1] == {
        "record_id": "REC-XYZ",
        "source_type": "faguquanji",
    }


@pytest.mark.asyncio
async def test_get_source_404_when_no_chunks(client, fake_rag_service, monkeypatch):
    """Unknown record_id / source_type → 404."""
    monkeypatch.setattr(fake_rag_service, "get_record_chunks", lambda *a, **k: [])
    resp = await client.get("/sources/faguquanji/does-not-exist")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Deep-dive thread filtering
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_list_threads_hides_deep_dive_by_default(client):
    """Threads created with metadata.deep_dive=true are absent from GET /threads."""
    # Regular thread.
    resp = await client.post("/threads", json={})
    regular_id = resp.json()["thread_id"]

    # Deep-dive thread.
    resp = await client.post(
        "/threads",
        json={"metadata": {"deep_dive": True, "parent_thread_id": regular_id}},
    )
    dd_id = resp.json()["thread_id"]

    # Default list: regular present, deep-dive hidden.
    resp = await client.get("/threads")
    assert resp.status_code == 200
    ids = [t["thread_id"] for t in resp.json()]
    assert regular_id in ids
    assert dd_id not in ids


@pytest.mark.asyncio
async def test_list_threads_include_deep_dive_param(client):
    """?include_deep_dive=true surfaces them for a research-history view."""
    resp = await client.post("/threads", json={})
    regular_id = resp.json()["thread_id"]

    resp = await client.post(
        "/threads",
        json={"metadata": {"deep_dive": True}},
    )
    dd_id = resp.json()["thread_id"]

    resp = await client.get("/threads?include_deep_dive=true")
    assert resp.status_code == 200
    ids = [t["thread_id"] for t in resp.json()]
    assert regular_id in ids
    assert dd_id in ids
