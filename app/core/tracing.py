"""Langfuse tracing integration.

Per design doc: all steps must be observable (Langfuse spans).
Per Langfuse skill: import Langfuse AFTER loading env vars, use callback handler.

Langfuse v4: trace attributes (user_id, session_id, tags, trace name) are passed
via config metadata, not CallbackHandler constructor args.
"""

from langfuse import get_client
from langfuse.langchain import CallbackHandler

from app.core.config import settings  # noqa: F401 — ensures .env is loaded first


def get_langfuse_config(
    *,
    user_id: str | None = None,
    session_id: str | None = None,
    trace_name: str = "agent-chat",
    tags: list[str] | None = None,
) -> dict:
    """Build a LangGraph/LangChain config dict with Langfuse callback + metadata.

    Usage:
        config = get_langfuse_config(user_id="u1", session_id="s1")
        result = await agent_graph.ainvoke(state, config=config)
    """
    handler = CallbackHandler()

    metadata: dict = {"langfuse_trace_name": trace_name}
    if user_id:
        metadata["langfuse_user_id"] = user_id
    if session_id:
        metadata["langfuse_session_id"] = session_id
    if tags:
        metadata["langfuse_tags"] = tags

    return {
        "callbacks": [handler],
        "metadata": metadata,
        "_langfuse_handler": handler,  # stash ref to read trace_id later
    }


def get_trace_id(config: dict) -> str | None:
    """Extract the Langfuse trace ID from a config after invocation."""
    handler = config.get("_langfuse_handler")
    if handler:
        return handler.last_trace_id
    return None


def flush_langfuse() -> None:
    """Flush pending Langfuse events. Call on app shutdown."""
    get_client().flush()


def shutdown_langfuse() -> None:
    """Shutdown the Langfuse client. Call on app shutdown."""
    get_client().shutdown()
