"""Graph nodes — each step is a standalone function.

Deterministic flow, no hidden logic inside an LLM, each step is a
function. The RAG service is injected via LangGraph's
`config["configurable"]["rag_service"]` by the API layer — nodes never
import provider modules directly.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from langchain_core.messages import AIMessage, HumanMessage
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


def _latest_user_query(state: AgentState) -> str:
    for msg in reversed(state.messages):
        if isinstance(msg, HumanMessage):
            content = msg.content
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                # Pick up text blocks from structured content.
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        return str(block.get("text", ""))
                    if isinstance(block, str):
                        return block
            return str(content)
    return ""


# ---------------------------------------------------------------------------
# Node: retrieve — fetch grounding hits for the latest user query
# ---------------------------------------------------------------------------
def retrieve(state: AgentState, config: RunnableConfig) -> dict:
    """Run the injected RagService.search and populate retrieval state."""
    query = _latest_user_query(state)
    if not query:
        return {
            "query": "",
            "retrieval_context": [],
            "retrieved_chunk_ids": [],
            "citations": [],
        }

    source_type = state.source_type or settings.default_source_type
    service = _rag_service(config)
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
    else:
        answer = service.generate(state.query, hits, history=None)
        content_text = answer.text
        citations_block = [c.model_dump(mode="json") for c in answer.citations]

    log.info(
        "generate | %d hits | answer=%d chars",
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
