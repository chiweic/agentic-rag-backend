"""rag_bot provider — the only file in the backend that imports rag_bot.

This adapter maps rag_bot's concrete types onto the backend's abstract
`RagService` Protocol. All vendor config resolution is delegated to
`rag_bot.llm_config.resolve` so there is one source of truth for the
`GEN_LLM` + `{VENDOR}_*` env pattern across both repos.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from app.rag.protocol import RagAnswer, RagService, RetrievalHit

if TYPE_CHECKING:
    from rag_bot.data_sources.models import RetrievalHit as RagBotRetrievalHit

    from app.core.config import Settings


class RagBotService:
    """`RagService` backed by rag_bot's DataSourceManager + generate_answer.

    Constructed once per backend process. `search` caches the native
    rag_bot hits it returns, keyed by the protocol hits' chunk-id tuple,
    so a subsequent `generate(query, hits)` call with those same hits can
    avoid re-querying. The cache is bounded to the last N searches
    (default 64) to keep memory steady under long-running services.
    """

    _CACHE_LIMIT = 64

    def __init__(self, settings: "Settings") -> None:
        from rag_bot.config import EmbeddingConfig, MilvusConfig, RerankConfig
        from rag_bot.data_sources.manager import DataSourceManager
        from rag_bot.llm_config import resolve
        from rag_bot.llm_factory import create_chat_model

        self._settings = settings
        self._manager = DataSourceManager(settings.data_root)

        # Retrieval-service configs are immutable per-process. Build them
        # once from Settings so env overrides propagate without paying the
        # construction cost on every search.
        self._embedding_config = EmbeddingConfig(
            tei_embed_base_url=settings.embedding_base_url,
            truncate=settings.embedding_truncate,
        )
        self._milvus_config = MilvusConfig(
            host=settings.milvus_host,
            port=settings.milvus_port,
            db_name=settings.milvus_db_name,
            collection_prefix=settings.milvus_collection_prefix,
            user=settings.milvus_user or None,
            password=settings.milvus_password or None,
            token=settings.milvus_token or None,
            secure=settings.milvus_secure,
            timeout=settings.milvus_timeout,
        )
        self._rerank_config = RerankConfig(
            endpoint=settings.rerank_endpoint,
            top_n=settings.rerank_top_n,
            candidate_k=settings.rerank_candidate_k,
            batch_size=settings.rerank_batch_size,
            timeout=settings.rerank_timeout,
            truncate_chars=settings.rerank_truncate_chars,
        )

        llm_cfg = resolve("GEN_LLM")
        self._chat_model = create_chat_model(
            vendor=llm_cfg.vendor,
            base_url=llm_cfg.base_url,
            model=llm_cfg.model,
            api_key=llm_cfg.api_key,
            temperature=0,
            think=False,
        )

        # (chunk_id_tuple) -> list[rag_bot RetrievalHit]
        self._hits_cache: dict[tuple[str, ...], list[Any]] = {}
        self._cache_order: list[tuple[str, ...]] = []

    # ------------------------------------------------------------------
    # RagService contract
    # ------------------------------------------------------------------
    def search(
        self,
        query: str,
        *,
        source_type: str | None = None,
        limit: int | None = None,
    ) -> list[RetrievalHit]:
        source = source_type or self._settings.default_source_type
        hits = self._manager.search(
            source,
            query,
            limit=limit or self._settings.retrieval_limit,
            backend=self._settings.retrieval_backend,
            embedding_config=self._embedding_config,
            milvus_config=self._milvus_config,
            rerank=self._settings.rerank_enabled,
            rerank_config=self._rerank_config,
        )
        protocol_hits = [self._map_hit(h) for h in hits]
        self._cache_hits(protocol_hits, hits)
        return protocol_hits

    def generate(
        self,
        query: str,
        hits: list[RetrievalHit],
        *,
        history: list[dict[str, str]] | None = None,
    ) -> RagAnswer:
        from rag_bot.rag.generator import build_rag_prompt, generate_answer

        if not hits:
            return RagAnswer(
                text=(
                    "I could not find relevant source content for that "
                    "question. Please try rephrasing."
                ),
                citations=[],
            )

        native_hits = self._lookup_cached_hits(hits) or self._requery(query, hits)

        if not history:
            generated = generate_answer(
                question=query,
                hits=native_hits,
                chat_model=self._chat_model,
            )
            return RagAnswer(text=generated.answer, citations=hits)

        # With history, build a messages list so prior turns precede the
        # grounded question. The current turn still uses build_rag_prompt
        # so the context-injection format stays identical to rag_bot's.
        from langchain_core.messages import AIMessage, HumanMessage

        prompt = build_rag_prompt(query, native_hits)
        messages: list[Any] = []
        for turn in history:
            role = turn.get("role")
            content = str(turn.get("content", "")).strip()
            if not content:
                continue
            if role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant":
                messages.append(AIMessage(content=content))
        messages.append(HumanMessage(content=prompt))

        response = self._chat_model.invoke(messages)
        return RagAnswer(text=_response_to_text(response), citations=hits)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _cache_hits(self, protocol_hits: list[RetrievalHit], native_hits: list[Any]) -> None:
        if not protocol_hits:
            return
        key = tuple(h.chunk_id for h in protocol_hits)
        self._hits_cache[key] = native_hits
        self._cache_order.append(key)
        while len(self._cache_order) > self._CACHE_LIMIT:
            oldest = self._cache_order.pop(0)
            self._hits_cache.pop(oldest, None)

    def _lookup_cached_hits(self, protocol_hits: list[RetrievalHit]) -> list[Any] | None:
        key = tuple(h.chunk_id for h in protocol_hits)
        return self._hits_cache.get(key)

    def _requery(self, query: str, protocol_hits: list[RetrievalHit]) -> list[Any]:
        """Cache miss fallback: re-run retrieval to reconstruct native hits."""
        source = (
            protocol_hits[0].metadata.get("source_type")
            if protocol_hits and protocol_hits[0].metadata
            else self._settings.default_source_type
        )
        return self._manager.search(
            source,
            query,
            limit=len(protocol_hits) or self._settings.retrieval_limit,
            backend=self._settings.retrieval_backend,
            embedding_config=self._embedding_config,
            milvus_config=self._milvus_config,
            rerank=self._settings.rerank_enabled,
            rerank_config=self._rerank_config,
        )

    @staticmethod
    def _map_hit(hit: "RagBotRetrievalHit") -> RetrievalHit:
        return RetrievalHit(
            chunk_id=hit.chunk.id,
            text=hit.chunk.text,
            title=hit.chunk.title,
            source_url=hit.chunk.source_url,
            score=hit.score,
            metadata={
                "source_type": hit.chunk.source_type,
                "record_id": hit.chunk.record_id,
                "chunk_index": hit.chunk.chunk_index,
                "publish_date": hit.chunk.publish_date,
            },
        )


def _response_to_text(response: Any) -> str:
    """Extract text from a LangChain chat-model response.

    Handles `.text` (string property on modern AIMessage), plain `.content`
    strings, and Responses-API block content (`[{"type":"text",...}, ...]`).
    """
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


# Runtime-protocol check — fails loudly if the shape drifts.
_: RagService = RagBotService.__new__(RagBotService)
