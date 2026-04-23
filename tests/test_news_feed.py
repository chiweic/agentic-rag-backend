"""Smoke tests for the news-feed adapter (features_v4 §2 scaffolding)."""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.news import build_news_feed
from app.news.protocol import NewsFeedProvider, NewsHeadline
from app.news.providers._static import StaticSampleFeed


def test_static_feed_implements_protocol():
    feed: NewsFeedProvider = StaticSampleFeed()
    # Runtime-checkable Protocol — assertion proves the shape.
    assert isinstance(feed, NewsFeedProvider)


def test_static_feed_returns_requested_count():
    feed = StaticSampleFeed()
    assert len(feed.get_headlines(3)) == 3
    assert len(feed.get_headlines(8)) == 8
    # Asking for more than the sample set returns what it has, never
    # raises — matches protocol guarantee that providers degrade.
    overflow = feed.get_headlines(1000)
    assert len(overflow) >= 1
    assert len(overflow) <= 1000


def test_static_feed_bounds_are_sane():
    feed = StaticSampleFeed()
    assert feed.get_headlines(0) == []
    assert feed.get_headlines(-1) == []


def test_static_feed_headlines_have_required_fields():
    feed = StaticSampleFeed()
    hits = feed.get_headlines(3)
    for h in hits:
        assert isinstance(h, NewsHeadline)
        assert h.id, "every headline needs a stable id for React keys"
        assert h.title, "title cannot be empty"


def test_build_news_feed_default_is_static():
    feed = build_news_feed(settings)
    assert isinstance(feed, StaticSampleFeed)


def test_build_news_feed_rejects_unknown_provider(monkeypatch):
    monkeypatch.setattr(settings, "news_feed_provider", "nope")
    with pytest.raises(RuntimeError, match="Unknown NEWS_FEED_PROVIDER"):
        build_news_feed(settings)
