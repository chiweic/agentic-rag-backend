"""Tests for the /whats-new-suggestions endpoint (features_v4.md §1)."""

from __future__ import annotations

import pytest

from app.news import set_news_feed
from app.news.protocol import NewsFeedProvider, NewsHeadline


class EmptyFeed:
    """NewsFeedProvider stub that returns no headlines."""

    def get_headlines(self, limit: int = 6) -> list[NewsHeadline]:
        return []


@pytest.mark.asyncio
async def test_whats_new_returns_ok_with_enriched_cards(client, monkeypatch):
    """Happy path: static feed headlines get paired with LLM actions
    and the combined prompt is built as `title + " " + action`."""
    from app.api import whats_new as whats_new_module
    from app.whats_new import enrich

    async def _fake_build_suggestions(headlines, *, interest_profile="", chat_model=None):
        return [
            enrich.EnrichedSuggestion(
                id=h.id,
                title=h.title,
                source=h.source,
                url=h.url,
                action="TEST_ACTION",
                combined_prompt=f"{h.title} TEST_ACTION",
            )
            for h in headlines
        ]

    monkeypatch.setattr(whats_new_module, "build_suggestions", _fake_build_suggestions)

    # Seed a thread so the profile path returns a non-empty list too
    # (exercise that branch), though any value goes through.
    resp = await client.post("/threads", json={})
    thread_id = resp.json()["thread_id"]
    await client.post(
        f"/threads/{thread_id}/runs/stream",
        json={"input": {"messages": [{"role": "user", "content": "seed"}]}},
    )

    resp = await client.get("/whats-new-suggestions?limit=3")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert len(body["suggestions"]) == 3
    first = body["suggestions"][0]
    assert first["title"]
    assert first["action"] == "TEST_ACTION"
    assert first["combined_prompt"].endswith("TEST_ACTION")


@pytest.mark.asyncio
async def test_whats_new_returns_no_feed_when_unset(client):
    """When lifespan hasn't installed a feed, endpoint reports
    no_feed rather than crashing."""
    set_news_feed(None)
    try:
        resp = await client.get("/whats-new-suggestions")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "no_feed"
        assert body["suggestions"] == []
    finally:
        # Test teardown in conftest also restores this, but do it
        # eagerly so a following assertion is unaffected if the
        # fixture ordering ever changes.
        from app.news.providers._static import StaticSampleFeed

        set_news_feed(StaticSampleFeed())


@pytest.mark.asyncio
async def test_whats_new_returns_no_news_when_feed_empty(client):
    """Feed returns zero headlines → endpoint reports no_news."""
    set_news_feed(EmptyFeed())
    try:
        resp = await client.get("/whats-new-suggestions")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "no_news"
        assert body["suggestions"] == []
    finally:
        from app.news.providers._static import StaticSampleFeed

        set_news_feed(StaticSampleFeed())


def test_empty_feed_conforms_to_protocol():
    feed: NewsFeedProvider = EmptyFeed()
    assert isinstance(feed, NewsFeedProvider)
