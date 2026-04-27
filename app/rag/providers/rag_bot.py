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

    def get_record_chunks(
        self,
        record_id: str,
        *,
        source_type: str,
    ) -> list[RetrievalHit]:
        """Pull every chunk for a single record via a Milvus query.

        Bypasses rag_bot's semantic search (which doesn't expose a
        Milvus filter expression) in favour of a direct
        `MilvusClient.query(expr="record_id == '...'")` against the
        same collection the search path resolves.
        """
        from pymilvus import MilvusClient
        from rag_bot.data_sources.manager import collection_name_for

        manifest = self._manager.get_manifest(source_type)
        collection = collection_name_for(source_type, manifest.version, self._milvus_config)

        client = MilvusClient(
            uri=f"http://{self._milvus_config.host}:{self._milvus_config.port}",
            db_name=self._milvus_config.db_name,
            user=self._milvus_config.user or "",
            password=self._milvus_config.password or "",
            token=self._milvus_config.token or "",
            secure=self._milvus_config.secure,
            timeout=self._milvus_config.timeout,
        )
        # `record_id` is stored as a string scalar; escape naively by
        # substituting single quotes. record_ids in this corpus don't
        # contain them but defense-in-depth.
        safe_id = record_id.replace("'", "''")
        rows = client.query(
            collection_name=collection,
            filter=f"record_id == '{safe_id}'",
            output_fields=[
                "text",
                "chunk_id",
                "record_id",
                "source_type",
                "source_url",
                "title",
                "publish_date",
                "chunk_index",
                "category",
                "attribution",
                "book_title",
                "chapter_title",
            ],
            limit=10000,
        )

        # Build protocol-level hits directly from the raw rows — we don't
        # go through rag_bot's RetrievalHit shape because we don't need
        # its record/citation fields for display-only context.
        hits: list[RetrievalHit] = []
        for row in rows:
            chunk_meta = {
                "source_type": row.get("source_type") or source_type,
                "record_id": row.get("record_id"),
                "chunk_index": int(row.get("chunk_index", 0) or 0),
                "publish_date": row.get("publish_date") or None,
            }
            for key in ("book_title", "chapter_title", "category", "attribution"):
                value = row.get(key)
                if value:
                    chunk_meta[key] = value
            hits.append(
                RetrievalHit(
                    chunk_id=str(row.get("chunk_id") or ""),
                    text=str(row.get("text") or ""),
                    title=str(row.get("title") or ""),
                    source_url=str(row.get("source_url") or "") or None,
                    score=None,
                    metadata=chunk_meta,
                )
            )

        hits.sort(key=lambda h: int(h.metadata.get("chunk_index", 0) or 0))
        return hits

    def generate(
        self,
        query: str,
        hits: list[RetrievalHit],
        *,
        history: list[dict[str, str]] | None = None,
        scope_record_id: str | None = None,
        variant: str | None = None,
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

        # Deep-dive uses its own prompt path: `get_record_chunks` already
        # returned every chunk of the pinned record, so we want to hand
        # the LLM the whole source as a single body, not as a list of
        # snippet "Excerpts" — that format made the model treat the text
        # as partial and refuse to summarize ("cannot find title X in
        # the provided excerpts"). See _generate_scoped.
        if scope_record_id:
            return self._generate_scoped(query, hits, history=history)

        native_hits = self._lookup_cached_hits(hits) or self._requery(query, hits)
        # Always pin the response to Traditional Chinese. The source corpus
        # (faguquanji) is in zh-TW, the UI targets zh-TW, but without an
        # explicit directive the LLM often drifts to Simplified zh-CN
        # — 業障 becomes 业障, 資料 becomes 资料, etc. The style
        # variant (e.g. "sheng_yen" for the 新鮮事 tab) is appended
        # so the model leans into the master's voice without losing
        # the language directive.
        prompt_prefix = _LANGUAGE_PROMPT_PREFIX
        variant_directive = _STYLE_DIRECTIVES.get((variant or "").lower())
        if variant_directive:
            prompt_prefix = f"{prompt_prefix}{variant_directive}"

        if not history:
            generated = generate_answer(
                question=query,
                hits=native_hits,
                chat_model=self._chat_model,
                prompt_prefix=prompt_prefix,
            )
            return RagAnswer(text=generated.answer, citations=hits)

        # With history, build a messages list so prior turns precede the
        # grounded question. The current turn still uses build_rag_prompt
        # so the context-injection format stays identical to rag_bot's.
        from langchain_core.messages import AIMessage, HumanMessage

        prompt = build_rag_prompt(query, native_hits, prompt_prefix=prompt_prefix)
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

    def _generate_scoped(
        self,
        query: str,
        hits: list[RetrievalHit],
        *,
        history: list[dict[str, str]] | None,
    ) -> RagAnswer:
        """Deep-dive generation: whole source as one body, not snippets.

        The hits here are every chunk of a single record, sorted by
        `chunk_index`, so joining their text reconstructs the full
        source. We put that into a system message framing it as "the
        complete content of source X" — the LLM then knows summarize /
        quote / outline requests target the whole thing, instead of
        treating each chunk as a separate excerpt it can't correlate.
        """
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

        meta = hits[0].metadata or {}
        title = (
            meta.get("chapter_title") or hits[0].title or meta.get("book_title") or "(未命名來源)"
        )
        book = meta.get("book_title")
        body = "\n\n".join(h.text for h in hits if h.text)

        header = f"《{book}·{title}》" if book and book != title else f"《{title}》"
        system_text = (
            f"{_LANGUAGE_PROMPT_PREFIX}"
            "你是法鼓山資料庫的助理,使用者已指定一份來源作為唯一依據。"
            "以下是該來源的完整內容:\n\n"
            f"=== {header} 完整內容開始 ===\n"
            f"{body}\n"
            f"=== {header} 完整內容結束 ===\n\n"
            "回答規則:\n"
            "- 根據上述完整內容回答使用者的問題,適時引用原文。\n"
            "- 若問題超出上述內容範圍,請明說「這份來源未涉及」,不要引用外部知識編造。\n"
            "- 不要把上述內容視為片段或節錄,它就是完整的來源文本。\n"
        )

        messages: list[Any] = [SystemMessage(content=system_text)]
        for turn in history or []:
            role = turn.get("role")
            content = str(turn.get("content", "")).strip()
            if not content:
                continue
            if role == "user":
                messages.append(HumanMessage(content=content))
            elif role == "assistant":
                messages.append(AIMessage(content=content))
        messages.append(HumanMessage(content=query))

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
        # Forward human-facing references from the chunk's metadata so the
        # frontend can display book/chapter/author context on citation
        # cards, plus A/V-specific fields (series_name / unit_name /
        # duration_s / playback_url / start_s / end_s) used by the 聖嚴
        # 師父身影 tab. Only non-empty values pass through — these keys
        # always exist in rag_bot's schema but are empty strings for
        # corpora that don't populate them (e.g. `book_title` is empty
        # on audio chunks; `series_name` is empty on faguquanji chunks).
        chunk_meta = hit.chunk.metadata or {}
        refs: dict[str, Any] = {}
        for key in (
            "book_title",
            "chapter_title",
            "category",
            "attribution",
            "series_name",
            "unit_name",
            "playback_url",
        ):
            value = chunk_meta.get(key)
            if value:
                refs[key] = value

        # Numeric fields — truthy check is wrong here (0.0 is valid for
        # `start_s` at the head of an audio), so explicit None guard.
        for key in ("duration_s", "start_s", "end_s"):
            value = chunk_meta.get(key)
            if value is not None:
                refs[key] = value

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
                **refs,
            },
        )


_LANGUAGE_PROMPT_PREFIX = (
    "Respond in Traditional Chinese (zh-TW, 繁體中文). Match the "
    "terminology used in the provided source — do not convert "
    "characters to Simplified Chinese.\n"
)


# Style variants the rag_bot provider understands. Callers pass
# `variant="sheng_yen"` through the RagService.generate kwarg; unknown
# variants are silently ignored (default answer style runs), keeping
# the surface forgiving while leaving room to add more voices later.
_STYLE_DIRECTIVES: dict[str, str] = {
    "sheng_yen": (
        "以 聖嚴法師的口吻回答,語氣沉穩、慈悲、平實;"
        "適時引用其著作與開示中的原文或精神,以當代聽眾能理解的語言闡述。\n"
    ),
}


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
