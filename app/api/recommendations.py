"""Event recommendation endpoint (features_v2.md §4a).

`GET /api/recommendations` stitches three pieces together:

1. Harvest the user's recent HumanMessage texts (default last 7 days).
2. LLM-summarize into a short interest profile.
3. Search the `events` source for matches against that profile.

Returns both the profile and the events so the frontend can show "we
picked these because you were asking about X" and keep the UI honest.
Empty recent activity yields `{profile: "", events: []}` with a
status the frontend can render as "no activity yet — come back after
chatting."
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.auth import UserClaims, get_current_user
from app.core.logging import get_logger
from app.rag import current_rag_service
from app.rag.protocol import RetrievalHit
from app.recommendations import collect_recent_queries, summarize_interests

log = get_logger(__name__)
router = APIRouter(tags=["recommendations"])


class RecommendationResponse(BaseModel):
    status: Literal["ok", "no_activity", "summary_failed", "no_matches"]
    profile: str
    events: list[dict]


@router.get("/recommendations", response_model=RecommendationResponse)
async def get_recommendations(
    limit: int = Query(default=6, ge=1, le=20),
    days: int = Query(default=7, ge=1, le=30),
    user: UserClaims = Depends(get_current_user),
) -> RecommendationResponse:
    queries = await collect_recent_queries(user.user_id, days=days)
    if not queries:
        return RecommendationResponse(status="no_activity", profile="", events=[])

    profile = await summarize_interests(queries)
    if not profile:
        return RecommendationResponse(status="summary_failed", profile="", events=[])

    # rag_service.search is sync and can hit Milvus + embedding service,
    # so push it to a worker thread rather than blocking the event loop.
    service = current_rag_service()
    hits: list[RetrievalHit] = await asyncio.to_thread(
        service.search,
        profile,
        source_type="events",
        limit=limit,
    )

    log.info(
        "recommendations | user=%s | queries=%d | profile=%r | hits=%d",
        user.user_id[:8],
        len(queries),
        profile[:80],
        len(hits),
    )

    events = [h.model_dump(mode="json") for h in hits]
    status: Literal["ok", "no_matches"] = "ok" if events else "no_matches"
    return RecommendationResponse(status=status, profile=profile, events=events)
