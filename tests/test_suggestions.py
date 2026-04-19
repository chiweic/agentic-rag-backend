"""Tests for starter + follow-up suggestions (features_v1 milestone 1)."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from app.suggestions.starter import (
    StarterStatus,
    StarterSuggestionsPool,
    _suggestion_id,
)


# ---------------------------------------------------------------------------
# Starter pool unit behavior
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_pool_builds_from_injected_sources():
    from app.core.config import settings

    titles = ["A?", "B?", "C?"]
    pool = StarterSuggestionsPool(
        settings=settings,
        title_source=lambda: list(titles),
        rephraser=lambda ts: [f"casual {t}" for t in ts],
    )
    assert pool.status == StarterStatus.WARMING_UP

    await pool.build()

    assert pool.status == StarterStatus.READY
    assert pool.size == 3
    assert {s.text for s in pool.get_random(3)} == {"casual A?", "casual B?", "casual C?"}


@pytest.mark.asyncio
async def test_pool_fails_gracefully_when_rephraser_raises():
    from app.core.config import settings

    def broken(titles):
        raise RuntimeError("nope")

    pool = StarterSuggestionsPool(
        settings=settings,
        title_source=lambda: ["A"],
        rephraser=broken,
    )
    await pool.build()
    assert pool.status == StarterStatus.FAILED
    assert pool.error is not None
    assert "nope" in pool.error


@pytest.mark.asyncio
async def test_pool_get_random_respects_n():
    from app.core.config import settings

    pool = StarterSuggestionsPool(
        settings=settings,
        title_source=lambda: [f"T{i}" for i in range(10)],
        rephraser=lambda ts: list(ts),
    )
    await pool.build()
    assert len(pool.get_random(4)) == 4
    assert len(pool.get_random(0)) == 0
    # Over-ask returns what's available.
    assert len(pool.get_random(99)) == 10


def test_suggestion_id_is_stable():
    assert _suggestion_id("hello") == _suggestion_id("hello")
    assert _suggestion_id("a") != _suggestion_id("b")


# ---------------------------------------------------------------------------
# GET /suggestions/starter
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_starter_endpoint_returns_suggestions(client):
    resp = await client.get("/suggestions/starter?n=3")
    assert resp.status_code == 200
    body = resp.json()
    assert "suggestions" in body
    assert len(body["suggestions"]) == 3
    for item in body["suggestions"]:
        assert item["id"].startswith("sug_")
        assert item["text"].startswith("Tell me about ")


@pytest.mark.asyncio
async def test_starter_endpoint_default_count(client):
    # Default n comes from settings.suggestions_default_n (4).
    resp = await client.get("/suggestions/starter")
    assert resp.status_code == 200
    assert len(resp.json()["suggestions"]) == 4


@pytest.mark.asyncio
async def test_starter_endpoint_clamps_n(client):
    # settings.suggestions_max_n is 10; request 999 → clamp to min(10, pool_size=5).
    resp = await client.get("/suggestions/starter?n=999")
    assert resp.status_code == 200
    assert len(resp.json()["suggestions"]) == 5  # pool has 5 titles


@pytest.mark.asyncio
async def test_starter_endpoint_503_when_warming_up(client):
    from app.core.config import settings as app_settings
    from app.main import app

    # Replace the ready fixture pool with one that never completes.
    app.state.starter_pool = StarterSuggestionsPool(
        settings=app_settings,
        title_source=lambda: ["A"],
        rephraser=lambda ts: list(ts),
    )
    # Do NOT call build(); status stays WARMING_UP.
    resp = await client.get("/suggestions/starter")
    assert resp.status_code == 503
    assert resp.json()["detail"]["status"] == "warming_up"


@pytest.mark.asyncio
async def test_starter_endpoint_500_when_build_failed(client):
    from app.core.config import settings as app_settings
    from app.main import app

    def boom(titles):
        raise RuntimeError("boom")

    pool = StarterSuggestionsPool(
        settings=app_settings,
        title_source=lambda: ["A"],
        rephraser=boom,
    )
    await pool.build()
    app.state.starter_pool = pool
    resp = await client.get("/suggestions/starter")
    assert resp.status_code == 500
    assert resp.json()["detail"]["status"] == "failed"


# ---------------------------------------------------------------------------
# Follow-up SSE event
# ---------------------------------------------------------------------------
def _parse_sse(text: str) -> list[dict]:
    events: list[dict] = []
    current: dict = {}
    for line in text.strip().split("\n"):
        if line.startswith("event: "):
            current["event"] = line[7:]
        elif line.startswith("data: "):
            current["data"] = line[6:]
        elif line == "" and current:
            events.append(current)
            current = {}
    if current:
        events.append(current)
    return events


@pytest.mark.asyncio
async def test_followup_event_emitted_on_grounded_answer(client):
    async def fake_followups(question, answer, *, n=3, chat_model=None):
        return [
            {"id": "fu_1", "text": "What about its history?"},
            {"id": "fu_2", "text": "How is it practiced today?"},
            {"id": "fu_3", "text": "Are there modern variations?"},
        ]

    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    with patch("app.api.threads.generate_followups", fake_followups):
        resp = await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={"input": {"messages": [{"role": "user", "content": "What is zen?"}]}},
        )

    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    suggestion_events = [e for e in events if e.get("event") == "suggestions/final"]
    assert (
        len(suggestion_events) == 1
    ), f"expected 1 suggestions/final, got {len(suggestion_events)}"
    payload = json.loads(suggestion_events[0]["data"])
    assert [s["text"] for s in payload["suggestions"]] == [
        "What about its history?",
        "How is it practiced today?",
        "Are there modern variations?",
    ]

    # suggestions/final must arrive AFTER values.
    event_order = [e.get("event") for e in events if e.get("event")]
    assert event_order.index("suggestions/final") > event_order.index("values")


@pytest.mark.asyncio
async def test_followup_skipped_when_answer_has_no_citations(client, fake_rag_service):
    """No-hits fallback → no follow-ups emitted."""
    # Make search return zero hits so the generate node emits NO_HITS_MESSAGE
    # with no citations block.
    fake_rag_service.search = lambda *a, **k: []  # type: ignore[assignment]

    called = {"count": 0}

    async def tracking_followups(question, answer, *, n=3, chat_model=None):
        called["count"] += 1
        return [{"id": "fu_x", "text": "should not run"}]

    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    with patch("app.api.threads.generate_followups", tracking_followups):
        resp = await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={"input": {"messages": [{"role": "user", "content": "..."}]}},
        )

    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    suggestion_events = [e for e in events if e.get("event") == "suggestions/final"]
    assert suggestion_events == []
    assert called["count"] == 0


@pytest.mark.asyncio
async def test_followup_failure_does_not_break_stream(client):
    async def boom(question, answer, *, n=3, chat_model=None):
        raise RuntimeError("follow-up LLM down")

    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]

    with patch("app.api.threads.generate_followups", boom):
        resp = await client.post(
            f"/threads/{thread_id}/runs/stream",
            json={"input": {"messages": [{"role": "user", "content": "What is zen?"}]}},
        )

    assert resp.status_code == 200
    events = _parse_sse(resp.text)
    # `values` still emitted; no suggestions/final; `end` still arrives.
    event_types = [e.get("event") for e in events]
    assert "values" in event_types
    assert "suggestions/final" not in event_types
    assert event_types[-1] == "end"


# ---------------------------------------------------------------------------
# Admin refresh endpoint (gated on AUTH_DEV_MODE=true at app startup)
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_admin_refresh_triggers_rebuild():
    """`_include_routers` mounts the admin refresh endpoint when dev-mode is
    on; POSTing to it kicks off a pool rebuild.

    Built against a fresh FastAPI + explicit Settings rather than the shared
    test client so the assertion holds regardless of the developer/CI env's
    AUTH_DEV_MODE value (tests should not depend on `.env`).
    """
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    from app.core.config import Settings
    from app.main import _include_routers

    fresh_app = FastAPI()
    _include_routers(fresh_app, Settings(auth_dev_mode=True))

    fake_pool = StarterSuggestionsPool(
        settings=Settings(auth_dev_mode=True),
        title_source=lambda: ["q"],
        rephraser=lambda ts: list(ts),
    )
    await fake_pool.build()
    fresh_app.state.starter_pool = fake_pool

    transport = ASGITransport(app=fresh_app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/admin/suggestions/refresh")

    assert resp.status_code == 200
    body = resp.json()
    assert body["triggered"] is True
    assert "prior_status" in body


@pytest.mark.asyncio
async def test_admin_refresh_not_mounted_without_dev_mode():
    """The admin router must NOT mount when AUTH_DEV_MODE is off."""
    from fastapi import FastAPI

    from app.core.config import Settings
    from app.main import _include_routers

    fresh_app = FastAPI()
    _include_routers(fresh_app, Settings(auth_dev_mode=False))

    paths = {route.path for route in fresh_app.routes}
    assert "/admin/suggestions/refresh" not in paths
