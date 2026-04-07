"""Assisted Learning routes."""

from fastapi import APIRouter, Depends

from app.core.auth import UserClaims, get_current_user
from app.core.logging import get_logger

log = get_logger(__name__)
router = APIRouter(tags=["assisted-learning"])


_STUB_MODULES = [
    {
        "id": "intro",
        "title": "Intro to Agentic RAG",
        "description": "What agentic RAG is, how it differs from classic RAG, and when to use it.",
        "href": "/assisted-learning/intro",
    },
    {
        "id": "retrieval",
        "title": "Dense vs Sparse Retrieval",
        "description": "Embedding vs keyword retrieval trade-offs, and when to combine them.",
        "href": "/assisted-learning/retrieval",
    },
    {
        "id": "observability",
        "title": "Observability with Langfuse",
        "description": "Tracing graph nodes, attaching user/session metadata, and debugging runs.",
        "href": "/assisted-learning/observability",
    },
]


@router.get("/assisted-learning/modules")
async def list_modules(user: UserClaims = Depends(get_current_user)):
    """Stub endpoint for listing available learning modules."""
    log.info("User %s requested assisted learning modules", user.sub)
    return {"modules": _STUB_MODULES}
