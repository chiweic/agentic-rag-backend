"""Factory for the backend's RAG service.

`get_rag_service(settings)` returns a concrete `RagService` based on
`settings.rag_provider`. Provider modules are lazily imported so a
missing provider dependency (e.g. rag_bot not installed) only errors if
you actually select that provider.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.rag.protocol import RagAnswer, RagService, RetrievalHit

if TYPE_CHECKING:
    from app.core.config import Settings

__all__ = ["RagService", "RetrievalHit", "RagAnswer", "get_rag_service"]


def get_rag_service(settings: "Settings") -> RagService:
    provider = (settings.rag_provider or "null").lower()

    if provider == "null":
        from app.rag.providers._null import NullRagService

        return NullRagService()

    if provider == "rag_bot":
        # Lazy import — rag_bot is an optional dependency.
        from app.rag.providers.rag_bot import RagBotService

        return RagBotService(settings)

    raise RuntimeError(
        f"Unknown RAG_PROVIDER={provider!r}. " f"Supported providers: null, rag_bot."
    )
