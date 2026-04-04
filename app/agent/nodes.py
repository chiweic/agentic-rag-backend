"""Graph nodes — each step is a standalone function.

Per design doc: deterministic flow, no hidden logic inside LLM,
each step must be a function, all steps must be observable.
"""

from langchain_core.messages import AIMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.agent.state import AgentState
from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)

SYSTEM_PROMPT = (
    "You are a helpful assistant. "
    "Answer the user's question clearly and concisely. "
    "If you don't know, say so."
)


def get_llm() -> ChatOpenAI:
    """Create LLM instance. Centralised so every node shares the same config."""
    return ChatOpenAI(
        model=settings.openai_model,
        base_url=settings.openai_api_base,
        api_key=settings.openai_api_key,
        temperature=0,
        streaming=True,
    )


# ---------------------------------------------------------------------------
# Node: generate — calls the LLM with conversation history
# ---------------------------------------------------------------------------
def generate(state: AgentState) -> dict:
    """Generate a response from the LLM.

    Currently a direct LLM call. When RAG is added, this node will receive
    retrieved + reranked documents in state and include them in the prompt.
    """
    llm = get_llm()
    # Only prepend default system prompt if no system message was provided
    if state.messages and isinstance(state.messages[0], SystemMessage):
        messages = list(state.messages)
    else:
        messages = [SystemMessage(content=SYSTEM_PROMPT), *state.messages]

    # Sliding window — keep system message + last N messages for LLM
    total_before = len(messages)
    window = settings.max_message_window
    if len(messages) > window + 1:  # +1 for system message
        messages = [messages[0], *messages[-(window):]]

    log.info(
        "generate | %d messages (%d in history, %d sent to LLM) | model=%s",
        total_before, total_before - 1, len(messages) - 1, settings.openai_model,
    )

    response: AIMessage = llm.invoke(messages)
    log.info("generate | response: %d chars", len(response.content))
    return {"messages": [response]}


# ---------------------------------------------------------------------------
# Placeholder nodes for future RAG pipeline steps
# Uncomment and wire into the graph when retrieval is ready.
# ---------------------------------------------------------------------------
#
# def extract_query(state: AgentState) -> dict:
#     """Extract the search query from the latest user message."""
#     ...
#
# def dense_retrieve(state: AgentState) -> dict:
#     """Dense vector retrieval from Milvus."""
#     ...
#
# def sparse_retrieve(state: AgentState) -> dict:
#     """BM25 sparse retrieval from Milvus."""
#     ...
#
# def merge_rrf(state: AgentState) -> dict:
#     """Reciprocal Rank Fusion of dense + sparse results."""
#     ...
#
# def rerank(state: AgentState) -> dict:
#     """Rerank merged documents with BGE/Qwen reranker."""
#     ...
