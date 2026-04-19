"""Abstract RAG service contract consumed by the LangGraph nodes and API layer.

Backend code depends only on the types in this module. Concrete
implementations live under `app.rag.providers.*` and never leak their
internal types up to graph/api code. To add a new provider (e.g. a
future `rag_bot_v2`), drop a new file under `providers/`, implement
`RagService`, register it in `app.rag.__init__.get_rag_service`, and
set `RAG_PROVIDER` accordingly — no other file needs to change.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel, Field


class RetrievalHit(BaseModel):
    """One retrieved chunk with enough context to cite."""

    chunk_id: str
    text: str
    title: str
    source_url: str | None = None
    score: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagAnswer(BaseModel):
    """Generated answer plus the hits it was grounded on."""

    text: str
    citations: list[RetrievalHit] = Field(default_factory=list)


@runtime_checkable
class RagService(Protocol):
    """Backend's abstract RAG contract. Any provider implementing this
    can be swapped in via the RAG_PROVIDER env var."""

    def search(
        self,
        query: str,
        *,
        source_type: str | None = None,
        limit: int = 5,
    ) -> list[RetrievalHit]:
        """Retrieve relevant hits for the query."""
        ...

    def get_record_chunks(
        self,
        record_id: str,
        *,
        source_type: str,
    ) -> list[RetrievalHit]:
        """Return all chunks belonging to a single source record.

        Used by the deep-dive flow to pin a whole source as retrieval
        context (vs. semantic search across the whole corpus) and by the
        `GET /sources/{source_type}/{record_id}` endpoint. Chunks are
        returned in `chunk_index` order so callers can concatenate them
        for display.
        """
        ...

    def generate(
        self,
        query: str,
        hits: list[RetrievalHit],
        *,
        history: list[dict[str, str]] | None = None,
    ) -> RagAnswer:
        """Generate a grounded answer from the retrieved hits."""
        ...
