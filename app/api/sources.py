"""Source content endpoint — fetches the full record for deep-dive display.

Used by the frontend's `DeepDiveOverlay` to show the entire source
(all chunks, in order) in the left pane while a scoped chat runs in
the right pane.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import UserClaims, get_current_user
from app.core.logging import get_logger
from app.rag import current_rag_service

log = get_logger(__name__)
router = APIRouter(tags=["sources"])


@router.get("/sources/{source_type}/{record_id}")
async def get_source(
    source_type: str,
    record_id: str,
    _: UserClaims = Depends(get_current_user),
) -> dict:
    """Return the full record as a list of chunks plus record-level metadata.

    Chunks are ordered by `chunk_index` so the frontend can concatenate
    them directly for display. Returns 404 if the record has no chunks
    (either unknown record_id or unknown source_type).
    """
    service = current_rag_service()
    hits = service.get_record_chunks(record_id, source_type=source_type)
    if not hits:
        raise HTTPException(
            status_code=404,
            detail=f"No chunks found for {source_type}/{record_id}",
        )

    first = hits[0]
    return {
        "record_id": record_id,
        "source_type": source_type,
        "title": first.title,
        "source_url": first.source_url,
        "book_title": first.metadata.get("book_title"),
        "chapter_title": first.metadata.get("chapter_title"),
        "attribution": first.metadata.get("attribution"),
        "publish_date": first.metadata.get("publish_date"),
        "chunks": [h.model_dump(mode="json") for h in hits],
    }
