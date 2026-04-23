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


def test_build_news_feed_selects_google_rss(monkeypatch):
    from app.news.providers._google_rss import GoogleNewsRssFeed

    monkeypatch.setattr(settings, "news_feed_provider", "google_rss")
    assert isinstance(build_news_feed(settings), GoogleNewsRssFeed)


def test_google_rss_parser_extracts_and_strips_suffix():
    """Parser strips the ' - 來源' title suffix when a <source> child is
    present, routes the publisher into NewsHeadline.source, and
    ignores items missing a title or link."""
    from app.news.providers._google_rss import parse_google_rss

    xml = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News</title>
    <item>
      <title>氣候變遷造成極端天氣 - 中央社</title>
      <link>https://news.google.com/articles/abc</link>
      <pubDate>Mon, 23 Apr 2026 05:00:00 GMT</pubDate>
      <source url="https://www.cna.com.tw/">中央社</source>
    </item>
    <item>
      <title>沒來源的新聞標題</title>
      <link>https://news.google.com/articles/def</link>
      <pubDate>Mon, 23 Apr 2026 06:00:00 GMT</pubDate>
    </item>
    <item>
      <!-- missing <link> should be skipped -->
      <title>壞資料 - 未知</title>
    </item>
  </channel>
</rss>""".encode()
    rows = parse_google_rss(xml)
    assert len(rows) == 2

    first, second = rows
    assert first.title == "氣候變遷造成極端天氣"  # suffix stripped
    assert first.source == "中央社"
    assert first.url == "https://news.google.com/articles/abc"
    assert first.published_at == "Mon, 23 Apr 2026 05:00:00 GMT"

    assert second.title == "沒來源的新聞標題"
    assert second.source == ""  # no <source> child
    assert second.url == "https://news.google.com/articles/def"


def test_google_rss_feed_swallows_fetch_errors(monkeypatch):
    """Protocol guarantees get_headlines never raises — so a broken
    urllib call yields an empty list, not a 500 at the endpoint."""
    from app.news.providers._google_rss import GoogleNewsRssFeed

    feed = GoogleNewsRssFeed()

    def _blow_up(*args, **kwargs):
        raise OSError("simulated network fail")

    monkeypatch.setattr("urllib.request.urlopen", _blow_up)
    assert feed.get_headlines(5) == []
