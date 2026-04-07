"""Agent state definition for the LangGraph pipeline."""

from typing import Annotated

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field


class AgentState(BaseModel):
    """State that flows through the LangGraph pipeline.

    Each node reads from and writes to this state.
    Extend with retrieval fields (documents, scores) when adding RAG steps.
    """

    messages: Annotated[list[BaseMessage], add_messages] = Field(default_factory=list)

    # Trace metadata — set by the API layer, consumed by Langfuse callback
    user_id: str | None = None
    session_id: str | None = None

    # Future RAG fields (uncomment when adding retrieval)
    # query: str = ""
    # documents: list[dict] = Field(default_factory=list)
    # reranked_documents: list[dict] = Field(default_factory=list)
