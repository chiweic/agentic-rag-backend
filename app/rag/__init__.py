"""Factory + module-level access for the backend's RAG service.

`build_rag_service(settings)` constructs a concrete `RagService` based
on `settings.rag_provider`. Called once from the FastAPI lifespan, it
also caches the result on a module-global so `current_rag_service()`
works from inside request handlers without threading the FastAPI
`Request` through every signature.

Provider modules are lazily imported so a missing provider dependency
(e.g. rag_bot not installed) only errors if you actually select it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.rag.protocol import RagAnswer, RagService, RetrievalHit

if TYPE_CHECKING:
    from app.core.config import Settings

__all__ = [
    "RagService",
    "RetrievalHit",
    "RagAnswer",
    "build_rag_service",
    "get_rag_service",
    "current_rag_service",
    "set_rag_service",
]

_SERVICE: RagService | None = None


def set_rag_service(service: RagService | None) -> None:
    """Install (or clear) the process-wide RagService. Called by lifespan."""
    global _SERVICE
    _SERVICE = service


def current_rag_service() -> RagService | None:
    """Return the process-wide RagService, or None if not yet built."""
    return _SERVICE


def build_rag_service(settings: "Settings") -> RagService:
    """Construct a `RagService` according to `settings.rag_provider`."""
    provider = (settings.rag_provider or "null").lower()

    if provider == "null":
        from app.rag.providers._null import NullRagService

        return NullRagService()

    if provider == "rag_bot":
        # Lazy import — rag_bot is an optional dependency.
        from app.rag.providers.rag_bot import RagBotService

        return RagBotService(settings)

    raise RuntimeError(f"Unknown RAG_PROVIDER={provider!r}. Supported providers: null, rag_bot.")


# Back-compat alias — pre-Phase-A3 callers used get_rag_service(settings).
get_rag_service = build_rag_service
