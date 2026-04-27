"""Abstract news-feed contract for the 新鮮事 tab (features_v4.md).

Backend code depends only on `NewsHeadline` + `NewsFeedProvider`.
Concrete providers live under `app/news/providers/*`; they're free to
scrape RSS, hit NewsAPI, call an internal DDM feed, etc. The default
`static` provider returns a fixed set of sample headlines so the
feature works end-to-end before a real source is wired up.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, Field


class NewsHeadline(BaseModel):
    """One fetched news headline.

    Fields kept intentionally thin — the LLM only needs the title +
    source attribution to generate a dharma-action question, and the
    frontend needs a URL to render the "read source" affordance on the
    welcome card.
    """

    id: str = Field(..., description="Stable identifier for React keys.")
    title: str
    source: str = Field(
        default="",
        description="Publisher name (e.g. '中央社') if known, empty otherwise.",
    )
    url: str | None = Field(
        default=None,
        description="Direct link to the article. Renders as the card's "
        "'read source' affordance when present.",
    )
    published_at: str | None = Field(
        default=None,
        description="ISO-8601 timestamp if the provider exposes one; the "
        "frontend currently renders it verbatim so any human-readable "
        "string works.",
    )


@runtime_checkable
class NewsFeedProvider(Protocol):
    """Backend's abstract news-feed contract. Any provider implementing
    this can be swapped in via the `NEWS_FEED_PROVIDER` env var."""

    def get_headlines(self, limit: int = 6) -> list[NewsHeadline]:
        """Return up to `limit` current Taiwan-focused news headlines.

        Providers may return fewer than `limit` (e.g. upstream rate
        limit). Providers must never raise — any upstream failure
        should be logged and returned as an empty list so the caller
        can degrade gracefully.
        """
        ...
