"""Per-message thumbs-up/down feedback endpoint.

Assistant-UI's `FeedbackAdapter` calls `submit({message, type})` on
every thumb click. We translate that into an upsert on
`message_feedback` (thread, message, user) so a second click with a
different value replaces the prior one. DELETE clears the reaction
entirely (used when the user clicks the same thumb twice to undo).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import UserClaims, get_current_user
from app.core.logging import get_logger
from app.core.thread_store import clear_feedback, set_feedback

log = get_logger(__name__)
router = APIRouter(tags=["feedback"])


class FeedbackRequest(BaseModel):
    thread_id: str
    message_id: str
    feedback: Literal["positive", "negative"]


@router.post("/feedback", status_code=204)
async def post_feedback(
    body: FeedbackRequest,
    user: UserClaims = Depends(get_current_user),
) -> None:
    """Record (or replace) a thumbs-up/down reaction from the current user."""
    if not body.thread_id or not body.message_id:
        raise HTTPException(status_code=400, detail="thread_id and message_id required")
    await set_feedback(body.thread_id, body.message_id, user.user_id, body.feedback)


@router.delete("/feedback", status_code=204)
async def delete_feedback_endpoint(
    thread_id: str,
    message_id: str,
    user: UserClaims = Depends(get_current_user),
) -> None:
    """Clear the current user's reaction for a message, if any."""
    if not thread_id or not message_id:
        raise HTTPException(status_code=400, detail="thread_id and message_id required")
    await clear_feedback(thread_id, message_id, user.user_id)
