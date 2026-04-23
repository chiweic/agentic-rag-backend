"""Graph nodes — each step is a standalone function.

Deterministic flow, no hidden logic inside an LLM, each step is a
function. The RAG service is injected via LangGraph's
`config["configurable"]["rag_service"]` by the API layer — nodes never
import provider modules directly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from app.agent.state import AgentState
from app.core.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from app.rag.protocol import RagService

log = get_logger(__name__)

SYSTEM_PROMPT = (
    "You are a helpful assistant. "
    "Answer the user's question clearly and concisely. "
    "If you don't know, say so."
)

NO_HITS_MESSAGE = (
    "I could not find relevant source content for that question. " "Please try rephrasing."
)


def _rag_service(config: RunnableConfig) -> "RagService":
    """Extract the RagService injected by the API layer."""
    configurable = config.get("configurable") or {}
    service = configurable.get("rag_service")
    if service is None:
        raise RuntimeError(
            "No rag_service in LangGraph config. Inject it via "
            "graph.invoke(..., config={'configurable': {'rag_service': ...}})."
        )
    return service


def _message_text(msg: BaseMessage) -> str:
    """Flatten a message's content into plain text.

    Assistant messages carry a list of content blocks (text + citations);
    only the text blocks belong in history — citations are a rendering
    concern that would otherwise leak back into the prompt verbatim.
    """
    content = msg.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    return str(content) if content else ""


def _latest_user_query(state: AgentState) -> str:
    for msg in reversed(state.messages):
        if isinstance(msg, HumanMessage):
            return _message_text(msg)
    return ""


def _build_history(state: AgentState) -> list[dict[str, str]]:
    """Prior-turn role/content pairs for `RagService.generate`.

    Excludes the latest HumanMessage (that's the current query, passed
    separately) and caps the result at `settings.max_message_window` so
    prompt size stays bounded on long threads.
    """
    cutoff = len(state.messages)
    for i in range(len(state.messages) - 1, -1, -1):
        if isinstance(state.messages[i], HumanMessage):
            cutoff = i
            break

    history: list[dict[str, str]] = []
    for msg in state.messages[:cutoff]:
        text = _message_text(msg).strip()
        if not text:
            continue
        if isinstance(msg, HumanMessage):
            history.append({"role": "user", "content": text})
        elif isinstance(msg, AIMessage):
            history.append({"role": "assistant", "content": text})

    window = settings.max_message_window
    if window and len(history) > window:
        history = history[-window:]
    return history


# ---------------------------------------------------------------------------
# Node: retrieve — fetch grounding hits for the latest user query
# ---------------------------------------------------------------------------
def retrieve(state: AgentState, config: RunnableConfig) -> dict:
    """Run the injected RagService.search and populate retrieval state.

    Three modes, checked in order:
    1. Deep-dive scope (`scope_record_id` + `scope_source_type`): pull
       every chunk from that single record — whole-source context.
    2. Multi-source (`source_types` list): fan out semantic search once
       per corpus and round-robin interleave the hits. Used by the 聖嚴
       師父身影 tab which pulls from audio + two video corpora.
    3. Single-source (default): one semantic search against
       `source_type` or the configured default.
    """
    query = _latest_user_query(state)
    if not query:
        return {
            "query": "",
            "retrieval_context": [],
            "retrieved_chunk_ids": [],
            "citations": [],
        }

    service = _rag_service(config)

    if state.scope_record_id and state.scope_source_type:
        hits = service.get_record_chunks(
            state.scope_record_id,
            source_type=state.scope_source_type,
        )
        log.info(
            "retrieve | scoped | source=%s | record_id=%s | query=%r | %d chunks",
            state.scope_source_type,
            state.scope_record_id,
            query[:60],
            len(hits),
        )
        return {
            "query": query,
            "source_type": state.scope_source_type,
            "retrieval_context": [h.text for h in hits],
            "retrieved_chunk_ids": [h.chunk_id for h in hits],
            "citations": [h.model_dump(mode="json") for h in hits],
        }

    if state.source_types:
        hits = _multi_source_search(service, query, state.source_types)
        log.info(
            "retrieve | multi-source | sources=%s | query=%r | %d hits",
            ",".join(state.source_types),
            query[:60],
            len(hits),
        )
        return {
            "query": query,
            # Leave source_type blank — the hits span multiple sources.
            # Downstream generation only cares about the hits themselves.
            "source_type": None,
            "retrieval_context": [h.text for h in hits],
            "retrieved_chunk_ids": [h.chunk_id for h in hits],
            "citations": [h.model_dump(mode="json") for h in hits],
        }

    source_type = state.source_type or settings.default_source_type
    hits = service.search(query, source_type=source_type, limit=settings.retrieval_limit)
    rerank_marker = (
        f" | rerank={settings.rerank_candidate_k}->{settings.rerank_top_n}"
        if settings.rerank_enabled
        else ""
    )
    log.info(
        "retrieve | source=%s | query=%r | %d hits%s",
        source_type,
        query[:60],
        len(hits),
        rerank_marker,
    )
    return {
        "query": query,
        "source_type": source_type,
        "retrieval_context": [h.text for h in hits],
        "retrieved_chunk_ids": [h.chunk_id for h in hits],
        "citations": [h.model_dump(mode="json") for h in hits],
    }


def _multi_source_search(
    service: "RagService",
    query: str,
    source_types: list[str],
) -> list:
    """Fan out `service.search` across corpora and modality-priority merge.

    Per-source top-k is computed from `settings.retrieval_limit`
    distributed across the sources (ceiling-divide so a limit of 5 with
    3 sources still pulls 2 per source rather than 1). The merge is
    `merge_with_modality_priority` — videos before audio, round-robin
    within each modality.

    Defensively swallows per-source search failures: one flaky corpus
    shouldn't 5xx the whole multi-source retrieve.
    """
    if not source_types:
        return []

    from app.rag.merge import merge_with_modality_priority

    per_source_k = max(1, -(-settings.retrieval_limit // len(source_types)))  # ceil div
    per_source_hits: dict[str, list] = {}
    for source in source_types:
        try:
            hits = service.search(query, source_type=source, limit=per_source_k)
        except Exception:  # noqa: BLE001
            log.exception("retrieve | multi-source search failed | source=%s", source)
            per_source_hits[source] = []
            continue
        # rag_bot's search does not currently honour `limit` — it can
        # return more than requested. Truncate here so one corpus
        # can't fill every slot before the modality-priority merge
        # has a chance to round-robin across sources / groups.
        per_source_hits[source] = list(hits)[:per_source_k]

    return merge_with_modality_priority(
        per_source_hits,
        source_types,
        limit=settings.retrieval_limit,
    )


# ---------------------------------------------------------------------------
# Node: generate — synthesize a grounded answer from retrieved hits
# ---------------------------------------------------------------------------
def generate(state: AgentState, config: RunnableConfig) -> dict:
    """Call the injected RagService.generate and return an AIMessage.

    The assistant content carries a text block and a citations block so
    block-aware consumers (assistant-ui) can render sources inline. The
    OpenAI-compat layer flattens citations into a text footer.
    """
    from app.rag.protocol import RetrievalHit

    if not state.query:
        # No user query (e.g. warm-up call) — reply with empty string.
        return {"messages": [AIMessage(content="")]}

    service = _rag_service(config)
    hits = [RetrievalHit(**c) for c in state.citations]

    if not hits:
        content_text = NO_HITS_MESSAGE
        citations_block: list[dict[str, Any]] = []
        history: list[dict[str, str]] = []
    else:
        history = _build_history(state)
        answer = service.generate(
            state.query,
            hits,
            history=history or None,
            scope_record_id=state.scope_record_id,
            variant=state.generate_variant,
        )
        content_text = answer.text
        # Deep-dive mode: suppress the citations block. The user is already
        # pinned to the record via the left pane, so surfacing citation
        # cards in the chat would let them open a Deep Dive inside a
        # Deep Dive — which we treat as a loop rather than a feature.
        if state.scope_record_id:
            citations_block = []
        else:
            citations_block = [c.model_dump(mode="json") for c in answer.citations]

    thread_id = (config.get("configurable") or {}).get("thread_id") or "?"
    log.info(
        "generate | thread=%s | history=%d turns | query=%r | %d hits | answer=%d chars",
        str(thread_id)[:8],
        len(history),
        state.query[:60],
        len(hits),
        len(content_text),
    )

    content_blocks: list[dict[str, Any]] = [{"type": "text", "text": content_text}]
    if citations_block:
        content_blocks.append({"type": "citations", "citations": citations_block})

    return {"messages": [AIMessage(content=content_blocks)]}


# ---------------------------------------------------------------------------
# Title generation node (no RAG) — used by POST /threads/{id}/generate-title
# ---------------------------------------------------------------------------
def generate_title_llm() -> Any:
    """Build a non-RAG chat model for thread-title generation.

    Uses the same vendor-pattern config as the RAG service so titles and
    answers come from the same model by default.
    """
    from rag_bot.llm_config import resolve
    from rag_bot.llm_factory import create_chat_model

    cfg = resolve("GEN_LLM")
    return create_chat_model(
        vendor=cfg.vendor,
        base_url=cfg.base_url,
        model=cfg.model,
        api_key=cfg.api_key,
        temperature=0,
        think=False,
    )


# ---------------------------------------------------------------------------
# Placeholder nodes for future RAG pipeline expansion
# Uncomment and wire into the graph when adding query rewriting, hybrid
# retrieval, or reranking orchestration at the LangGraph level.
# ---------------------------------------------------------------------------
#
# def extract_query(state: AgentState) -> dict: ...
# def dense_retrieve(state: AgentState) -> dict: ...
# def sparse_retrieve(state: AgentState) -> dict: ...
# def merge_rrf(state: AgentState) -> dict: ...
# def rerank(state: AgentState) -> dict: ...

__all__ = ["retrieve", "generate", "generate_title_llm", "SYSTEM_PROMPT"]
