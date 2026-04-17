"""Starter suggestions — casual prompts rephrased from QA corpus titles.

The pool is built once in the FastAPI lifespan as an asyncio background
task so server startup isn't blocked on Milvus + LLM calls. Until the
pool is ready, the HTTP layer returns 503 with `{"status":"warming_up"}`
so the frontend can retry / show a placeholder.

Sampling strategy:
1. Auto-detect the latest `rag_bot_qa_*` collection (or honor
   `SUGGESTIONS_QA_COLLECTION` override).
2. Pull titles from rows where `chunk_index == 0` (avoids oversampling
   chunks of long answers). Dedup to unique titles.
3. Random-sample `SUGGESTIONS_POOL_SIZE` of them.
4. Batched LLM call via `SUGGEST_LLM` (falls back to `GEN_LLM`) rephrases
   each into a casual first-person prompt.

Requests for `n` suggestions return `random.sample(pool, n)` so the
frontend sees variation between page loads without per-call LLM cost.
"""

from __future__ import annotations

import asyncio
import os
import random
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger(__name__)

_QA_COLLECTION_PATTERN = re.compile(r"^rag_bot_qa_\d{8}t\d{6}_\d{6}z$")


class StarterStatus:
    WARMING_UP = "warming_up"
    READY = "ready"
    FAILED = "failed"


@dataclass(frozen=True)
class Suggestion:
    id: str
    text: str


@dataclass
class StarterSuggestionsPool:
    """In-process pool of rephrased starter prompts.

    `title_source` and `rephraser` are injection seams so tests can
    construct a pool without Milvus or an LLM. Production paths leave
    them at their defaults (resolved from settings).
    """

    settings: Settings
    title_source: Callable[[], list[str]] | None = None
    rephraser: Callable[[list[str]], list[str]] | None = None

    _status: str = field(default=StarterStatus.WARMING_UP, init=False)
    _pool: list[Suggestion] = field(default_factory=list, init=False)
    _error: str | None = field(default=None, init=False)
    _collection_name: str | None = field(default=None, init=False)

    @property
    def status(self) -> str:
        return self._status

    @property
    def error(self) -> str | None:
        return self._error

    @property
    def size(self) -> int:
        return len(self._pool)

    @property
    def collection_name(self) -> str | None:
        return self._collection_name

    def get_random(self, n: int) -> list[Suggestion]:
        """Return a random subset of up to `n` suggestions."""
        if not self._pool:
            return []
        k = max(0, min(n, len(self._pool)))
        return random.sample(self._pool, k)

    async def build(self) -> None:
        """Build (or rebuild) the pool. Safe to re-invoke to refresh."""
        self._status = StarterStatus.WARMING_UP
        self._error = None
        log.info(
            "starter-suggestions | building pool (target_size=%d)",
            self.settings.suggestions_pool_size,
        )
        try:
            titles = await asyncio.to_thread(self._resolve_titles)
            if not titles:
                log.warning("starter-suggestions | no titles resolved; pool empty")
                self._pool = []
            else:
                rephrased = await asyncio.to_thread(self._resolve_rephraser, titles)
                self._pool = [
                    Suggestion(id=_suggestion_id(text), text=text)
                    for text in rephrased
                    if text and text.strip()
                ]
            self._status = StarterStatus.READY
            log.info("starter-suggestions | pool ready | %d prompts", len(self._pool))
        except Exception as exc:  # noqa: BLE001
            self._status = StarterStatus.FAILED
            self._error = f"{exc.__class__.__name__}: {exc}"
            log.exception("starter-suggestions | pool build failed")

    def _resolve_titles(self) -> list[str]:
        if self.title_source is not None:
            return list(self.title_source())
        self._collection_name = _resolve_qa_collection(self.settings)
        log.info(
            "starter-suggestions | qa collection: %s",
            self._collection_name,
        )
        return _sample_qa_titles(
            self.settings,
            self._collection_name,
            self.settings.suggestions_pool_size,
        )

    def _resolve_rephraser(self, titles: list[str]) -> list[str]:
        fn = self.rephraser if self.rephraser is not None else _batch_rephrase
        return list(fn(titles))


# ---------------------------------------------------------------------------
# Milvus helpers
# ---------------------------------------------------------------------------
def _resolve_qa_collection(settings: Settings) -> str:
    """Pick the QA collection: explicit override wins, else latest by timestamp.

    Collection names follow `rag_bot_qa_<YYYYMMDDtHHMMSS>_<micro>z`.
    Lexicographic max matches chronological latest thanks to the fixed
    ISO-like timestamp format.
    """
    if settings.suggestions_qa_collection:
        return settings.suggestions_qa_collection

    from pymilvus import connections, utility

    alias = "suggestions_admin"
    connections.connect(
        alias=alias,
        host=settings.milvus_host,
        port=str(settings.milvus_port),
        db_name=settings.milvus_db_name,
        user=settings.milvus_user or None,
        password=settings.milvus_password or None,
        token=settings.milvus_token or None,
        secure=settings.milvus_secure,
    )
    try:
        candidates = [
            name
            for name in utility.list_collections(using=alias)
            if _QA_COLLECTION_PATTERN.match(name)
        ]
    finally:
        connections.disconnect(alias=alias)

    if not candidates:
        raise RuntimeError(
            f"No rag_bot_qa_* collections found in db "
            f"{settings.milvus_db_name!r} at "
            f"{settings.milvus_host}:{settings.milvus_port}"
        )
    return max(candidates)


def _sample_qa_titles(settings: Settings, collection_name: str, n: int) -> list[str]:
    """Pull unique titles from the collection, sample up to `n`."""
    from pymilvus import Collection, connections

    alias = "suggestions_sample"
    connections.connect(
        alias=alias,
        host=settings.milvus_host,
        port=str(settings.milvus_port),
        db_name=settings.milvus_db_name,
        user=settings.milvus_user or None,
        password=settings.milvus_password or None,
        token=settings.milvus_token or None,
        secure=settings.milvus_secure,
    )
    try:
        collection = Collection(collection_name, using=alias)
        collection.load()
        rows = collection.query(
            expr="chunk_index == 0",
            output_fields=["title"],
            limit=10000,
        )
    finally:
        connections.disconnect(alias=alias)

    titles = list({(r.get("title") or "").strip() for r in rows if r.get("title")})
    titles = [t for t in titles if t]
    if not titles:
        return []
    k = min(n, len(titles))
    return random.sample(titles, k)


# ---------------------------------------------------------------------------
# LLM rephrase helpers
# ---------------------------------------------------------------------------
_REPHRASE_SYSTEM = (
    "Rephrase each Q&A title into a short, casual first-person prompt "
    "as if a user is typing it into a chat box.\n"
    "Guidelines:\n"
    "- Under 12 words each.\n"
    "- Keep the original language (Chinese in → Chinese out).\n"
    "- Return one rephrased prompt per input, one per line, in the same order.\n"
    "- No numbering, no bullets, no quotation marks.\n"
)


def _batch_rephrase(titles: list[str]) -> list[str]:
    """One LLM call rephrases all titles; falls back to originals on drift."""
    from langchain_core.messages import HumanMessage

    chat_model = build_suggest_chat_model()
    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(titles))
    prompt = f"{_REPHRASE_SYSTEM}\nTitles:\n{numbered}"
    response = chat_model.invoke([HumanMessage(content=prompt)])
    text = _extract_response_text(response)

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    cleaned: list[str] = []
    for line in lines:
        m = re.match(r"^\s*\d+[.)\s-]+\s*(.*)$", line)
        candidate = (m.group(1) if m else line).strip().strip('"').strip("'")
        if candidate:
            cleaned.append(candidate)

    # If the model under-delivered (missing rows), fall back to the original
    # titles for the tail so we don't end up with a short pool.
    if len(cleaned) < len(titles):
        cleaned.extend(titles[len(cleaned) :])
    return cleaned[: len(titles)]


def build_suggest_chat_model() -> Any:
    """Resolve `SUGGEST_LLM` with fallback to `GEN_LLM`.

    Public so the follow-up generator can reuse the same vendor pattern.
    A small temperature keeps rephrasing varied without drifting off-topic.
    """
    from rag_bot.llm_config import resolve
    from rag_bot.llm_factory import create_chat_model

    role = "SUGGEST_LLM" if os.getenv("SUGGEST_LLM") else "GEN_LLM"
    cfg = resolve(role)
    return create_chat_model(
        vendor=cfg.vendor,
        base_url=cfg.base_url,
        model=cfg.model,
        api_key=cfg.api_key,
        temperature=0.3,
        think=False,
    )


def _extract_response_text(response: Any) -> str:
    """Flatten a chat-model response into plain text."""
    text_attr = getattr(response, "text", None)
    if isinstance(text_attr, str):
        return text_attr
    content = getattr(response, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        return "".join(parts)
    if callable(text_attr):
        return str(text_attr())
    return str(response)


def _suggestion_id(text: str) -> str:
    """Stable analytics id derived from the suggestion text."""
    return f"sug_{uuid.uuid5(uuid.NAMESPACE_URL, text).hex[:12]}"
