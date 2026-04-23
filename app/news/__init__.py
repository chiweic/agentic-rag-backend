"""Factory + module-level access for the news-feed adapter.

Mirrors `app/rag/__init__.py`'s shape: `build_news_feed(settings)`
constructs a concrete `NewsFeedProvider` based on
`settings.news_feed_provider`. Called once from the FastAPI lifespan
and cached on a module-global so request handlers can read it via
`current_news_feed()` without threading Settings through every
signature.

Concrete providers are lazily imported so a missing dependency for a
non-selected provider (e.g. an RSS library not installed) won't break
the default `"static"` path.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.news.protocol import NewsFeedProvider, NewsHeadline

if TYPE_CHECKING:
    from app.core.config import Settings

__all__ = [
    "NewsFeedProvider",
    "NewsHeadline",
    "build_news_feed",
    "current_news_feed",
    "set_news_feed",
]

_FEED: NewsFeedProvider | None = None


def set_news_feed(feed: NewsFeedProvider | None) -> None:
    """Install (or clear) the process-wide NewsFeedProvider."""
    global _FEED
    _FEED = feed


def current_news_feed() -> NewsFeedProvider | None:
    """Return the process-wide NewsFeedProvider, or None if not built."""
    return _FEED


def build_news_feed(settings: "Settings") -> NewsFeedProvider:
    """Construct a `NewsFeedProvider` per `settings.news_feed_provider`."""
    provider = (settings.news_feed_provider or "static").lower()

    if provider == "static":
        from app.news.providers._static import StaticSampleFeed

        return StaticSampleFeed()

    raise RuntimeError(f"Unknown NEWS_FEED_PROVIDER={provider!r}. Supported: static.")
