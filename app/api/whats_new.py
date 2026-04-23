"""Welcome-suggestion endpoint for the 新鮮事 tab (features_v4.md §1).

`GET /whats-new-suggestions` stitches three pieces together:

1. Pull top-N news headlines from the configured `NewsFeedProvider`.
2. Build a one-or-two-sentence interest profile from the user's
   recent HumanMessage texts (reuses the §4a recommendations helper).
3. Ask the suggest LLM, in one batch call, to produce a short dharma
   "action" question per headline grounded in that profile. Returns
   the headline + action + combined prompt the frontend card will
   send when clicked.

Never 5xxs on upstream failure — both the news feed and the LLM
enrichment degrade to a generic fallback so the frontend can always
render at least the titles. The `status` field disambiguates "no
news available" from "no recent activity" when the caller wants to
show different copy.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.auth import UserClaims, get_current_user
from app.core.logging import get_logger
from app.news import current_news_feed
from app.recommendations import collect_recent_queries, summarize_interests
from app.whats_new import build_suggestions

log = get_logger(__name__)
router = APIRouter(tags=["whats-new"])


class WhatsNewSuggestion(BaseModel):
    id: str
    title: str
    source: str
    url: str | None
    action: str
    combined_prompt: str


class WhatsNewResponse(BaseModel):
    status: Literal["ok", "no_news", "no_feed"]
    profile: str
    suggestions: list[WhatsNewSuggestion]


@router.get("/whats-new-suggestions", response_model=WhatsNewResponse)
async def get_whats_new(
    limit: int = Query(default=6, ge=1, le=20),
    days: int = Query(default=7, ge=1, le=30),
    user: UserClaims = Depends(get_current_user),
) -> WhatsNewResponse:
    feed = current_news_feed()
    if feed is None:
        return WhatsNewResponse(status="no_feed", profile="", suggestions=[])

    headlines = feed.get_headlines(limit)
    if not headlines:
        return WhatsNewResponse(status="no_news", profile="", suggestions=[])

    # Interest profile is best-effort — empty profile is a valid input
    # to `build_suggestions` (the LLM still produces reasonable actions
    # from the headline alone), so we don't short-circuit on no_activity.
    queries = await collect_recent_queries(user.user_id, days=days)
    profile = await summarize_interests(queries) if queries else ""

    enriched = await build_suggestions(headlines, interest_profile=profile)

    log.info(
        "whats_new | user=%s | headlines=%d | profile=%r",
        user.user_id[:8],
        len(enriched),
        profile[:60],
    )

    return WhatsNewResponse(
        status="ok",
        profile=profile,
        suggestions=[
            WhatsNewSuggestion(
                id=e.id,
                title=e.title,
                source=e.source,
                url=e.url,
                action=e.action,
                combined_prompt=e.combined_prompt,
            )
            for e in enriched
        ],
    )
