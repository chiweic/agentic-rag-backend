"""Quiz generation endpoint — used by the Deep Dive overlay's 小測驗 modal.

POSTed with a `{record_id, source_type}` body; resolves all chunks for
that record via the current RagService and asks the suggest LLM to
emit a 4-question MCQ in the shape question-flow consumes directly.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import UserClaims, get_current_user
from app.core.logging import get_logger
from app.quiz import Quiz, generate_quiz
from app.rag import current_rag_service

log = get_logger(__name__)
router = APIRouter(tags=["quiz"])


class QuizRequest(BaseModel):
    record_id: str
    source_type: str
    n: int = Field(default=4, ge=1, le=8)


@router.post("/quiz/generate", response_model=Quiz)
async def quiz_generate(
    body: QuizRequest,
    _: UserClaims = Depends(get_current_user),
) -> Quiz:
    service = current_rag_service()
    hits = service.get_record_chunks(body.record_id, source_type=body.source_type)
    if not hits:
        raise HTTPException(
            status_code=404,
            detail=f"No chunks found for {body.source_type}/{body.record_id}",
        )
    quiz = await generate_quiz(hits, n=body.n)
    if not quiz.steps:
        # Distinguish "we tried and the LLM didn't produce a usable quiz"
        # from "you asked about a record we don't have" (404 above).
        raise HTTPException(
            status_code=502,
            detail="Quiz generation produced no questions",
        )
    return quiz
