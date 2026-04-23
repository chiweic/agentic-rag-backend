"""Agent state definition for the LangGraph pipeline."""

from typing import Annotated, Any

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field


class AgentState(BaseModel):
    """State that flows through the LangGraph pipeline.

    Each node reads from and writes to this state. Retrieval fields are
    populated by the `retrieve` node and consumed by `generate`.
    """

    messages: Annotated[list[BaseMessage], add_messages] = Field(default_factory=list)

    # Trace metadata — set by the API layer, consumed by Langfuse callback
    user_id: str | None = None
    session_id: str | None = None

    # RAG fields (populated by the retrieve node)
    query: str = ""
    source_type: str | None = None
    # Multi-source retrieval: when set and non-empty, the retrieve node
    # fans out one semantic search per corpus and round-robin interleaves
    # the results. Takes precedence over `source_type` (single-source).
    # Used by the 聖嚴師父身影 tab to pull from audio + two video corpora
    # simultaneously (see [app/agent/nodes.py] retrieve()).
    source_types: list[str] | None = None
    # Deep-dive scope: when both are set, the retrieve node pulls every
    # chunk from this record instead of running semantic search — pinning
    # the whole source as context for a focused conversation.
    scope_record_id: str | None = None
    scope_source_type: str | None = None
    retrieval_context: list[str] = Field(default_factory=list)
    retrieved_chunk_ids: list[str] = Field(default_factory=list)
    citations: list[dict[str, Any]] = Field(default_factory=list)
