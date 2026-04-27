"""Recommendation endpoint (features_v2.md §4a, extended in features_v3.md).

`GET /api/recommendations` stitches three pieces together:

1. Harvest the user's recent HumanMessage texts (default last 7 days).
2. LLM-summarize into a short interest profile.
3. Search one or more rag_bot corpora for matches against that profile.

By default the single `events` corpus is queried — the original §4a
behaviour. When `?sources=a,b,c` is passed (v3 §1), each corpus is
queried independently with a ceiling-divided per-corpus limit and the
results are round-robin interleaved so every source appears in the
returned grid. The 聖嚴師父身影 tab uses this with
`sources=audio,video_ddmtv01,video_ddmtv02`.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.auth import UserClaims, get_current_user
from app.core.logging import get_logger
from app.rag import current_rag_service
from app.rag.protocol import RetrievalHit
from app.recommendations import collect_recent_queries, summarize_interests

log = get_logger(__name__)
router = APIRouter(tags=["recommendations"])


# Allowlist for the `sources` query param. Keeps typos (e.g. plural
# forms) from silently returning empty results, and documents which
# corpora the recommendation endpoint understands today. Add here when
# rag_bot ingests a new corpus we want to expose to users.
_ALLOWED_SOURCES = frozenset(
    {
        "events",
        "audio",
        "video_ddmtv01",
        "video_ddmtv02",
        "video_ddmmedia1321",
        "news",
        "faguquanji",
    }
)


class RecommendationResponse(BaseModel):
    status: Literal["ok", "no_activity", "summary_failed", "no_matches"]
    profile: str
    events: list[dict]


@router.get("/recommendations", response_model=RecommendationResponse)
async def get_recommendations(
    limit: int = Query(default=6, ge=1, le=20),
    days: int = Query(default=7, ge=1, le=30),
    sources: str | None = Query(
        default=None,
        description=(
            "Comma-separated rag_bot source types to pull recommendations "
            "from. Defaults to 'events' (§4a behaviour). Pass "
            "'audio,video_ddmtv01,video_ddmtv02' for the 聖嚴師父身影 tab."
        ),
    ),
    user: UserClaims = Depends(get_current_user),
) -> RecommendationResponse:
    source_types = _parse_sources(sources)

    queries = await collect_recent_queries(user.user_id, days=days)
    if not queries:
        return RecommendationResponse(status="no_activity", profile="", events=[])

    profile = await summarize_interests(queries)
    if not profile:
        return RecommendationResponse(status="summary_failed", profile="", events=[])

    service = current_rag_service()
    hits = await asyncio.to_thread(_search_multi, service, profile, source_types, limit)

    log.info(
        "recommendations | user=%s | sources=%s | queries=%d | profile=%r | hits=%d",
        user.user_id[:8],
        ",".join(source_types),
        len(queries),
        profile[:80],
        len(hits),
    )

    events = [h.model_dump(mode="json") for h in hits]
    status: Literal["ok", "no_matches"] = "ok" if events else "no_matches"
    return RecommendationResponse(status=status, profile=profile, events=events)


def _parse_sources(raw: str | None) -> list[str]:
    if not raw:
        return ["events"]
    parsed = [s.strip() for s in raw.split(",") if s.strip()]
    unknown = [s for s in parsed if s not in _ALLOWED_SOURCES]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown source(s): {', '.join(unknown)}. "
            f"Allowed: {', '.join(sorted(_ALLOWED_SOURCES))}.",
        )
    return parsed or ["events"]


def _search_multi(
    service,
    query: str,
    source_types: list[str],
    limit: int,
) -> list[RetrievalHit]:
    """Per-source top-k + modality-priority merge.

    Delegates ordering to `app.rag.merge.merge_with_modality_priority`
    so the rule ("videos before audio, round-robin within each
    modality") stays co-located with the agent-side retrieval merge.
    """
    if not source_types:
        return []

    from app.rag.merge import merge_with_modality_priority

    per_source_k = max(1, -(-limit // len(source_types)))  # ceil div
    per_source_hits: dict[str, list[RetrievalHit]] = {}
    for source in source_types:
        try:
            hits = service.search(query, source_type=source, limit=per_source_k)
        except Exception:  # noqa: BLE001
            log.exception("recommendations | search failed | source=%s", source)
            per_source_hits[source] = []
            continue
        # See comment in app/agent/nodes.py::_multi_source_search —
        # rag_bot's search doesn't honour `limit`, so one corpus can
        # flood the merge without this truncation.
        per_source_hits[source] = list(hits)[:per_source_k]

    return merge_with_modality_priority(per_source_hits, source_types, limit=limit)
