"""Null provider — returns empty hits and a pass-through answer.

Used when RAG_PROVIDER is unset or explicitly "null". Lets the backend
boot without RAG wired (useful during partial integrations and tests
that don't need retrieval).
"""

from __future__ import annotations

from app.rag.protocol import RagAnswer, RagService, RetrievalHit


class NullRagService:
    """No-op `RagService`. `search` always returns `[]`; `generate`
    echoes the query."""

    def search(
        self,
        query: str,
        *,
        source_type: str | None = None,
        limit: int = 5,
    ) -> list[RetrievalHit]:
        return []

    def generate(
        self,
        query: str,
        hits: list[RetrievalHit],
        *,
        history: list[dict[str, str]] | None = None,
    ) -> RagAnswer:
        return RagAnswer(
            text=("(no RAG provider configured) — echoing query: " f"{query}"),
            citations=[],
        )


# Runtime-protocol check (fails loudly if the shape drifts).
_: RagService = NullRagService()
