"""Starter-suggestions endpoints.

- `GET /suggestions/starter?n=4` — random subset from the in-process pool.
  Returns 503 `{"status":"warming_up"}` while the pool is still building
  on startup, 500 if the build failed.
- `POST /admin/suggestions/refresh` — rebuilds the pool. Dev-only, mounted
  only when `AUTH_DEV_MODE=true` (same gate as the dev-token router).

Follow-up suggestions are not served from a REST endpoint; they arrive as
an SSE event on `/threads/{id}/runs/stream` — see `app/api/threads.py`.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import get_logger
from app.suggestions import StarterStatus, StarterSuggestionsPool

log = get_logger(__name__)

router = APIRouter(prefix="/suggestions", tags=["suggestions"])
admin_router = APIRouter(prefix="/admin/suggestions", tags=["admin"])


class SuggestionDTO(BaseModel):
    id: str
    text: str


class StarterResponse(BaseModel):
    suggestions: list[SuggestionDTO]


def _pool(request: Request) -> StarterSuggestionsPool:
    pool = getattr(request.app.state, "starter_pool", None)
    if pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "warming_up"},
        )
    return pool


@router.get(
    "/starter",
    response_model=StarterResponse,
    responses={
        503: {"description": "Pool is still warming up"},
        500: {"description": "Pool build failed"},
    },
)
async def get_starter(request: Request, n: int | None = None) -> StarterResponse:
    pool = _pool(request)
    if pool.status == StarterStatus.WARMING_UP:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"status": "warming_up"},
        )
    if pool.status == StarterStatus.FAILED:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"status": "failed", "error": pool.error or "unknown"},
        )

    requested = n if n is not None else settings.suggestions_default_n
    clamped = max(1, min(requested, settings.suggestions_max_n))
    items = pool.get_random(clamped)
    return StarterResponse(suggestions=[SuggestionDTO(id=s.id, text=s.text) for s in items])


@admin_router.post("/refresh")
async def refresh_starter(request: Request) -> dict:
    """Kick off a pool rebuild. Returns immediately with current status.

    Dev-only — mounted by `main.py` only when `AUTH_DEV_MODE=true`.
    """
    pool = _pool(request)
    asyncio.create_task(pool.build())
    log.info("starter-suggestions | refresh triggered (prior status=%s)", pool.status)
    return {"triggered": True, "prior_status": pool.status}
