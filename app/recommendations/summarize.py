"""Recent-query harvest + interest profile summarization.

`collect_recent_queries` walks the user's threads created within the
last `days` days (default 7) and pulls every HumanMessage text from
each thread's latest LangGraph checkpoint. Deep-dive threads are
excluded — their queries are pinned to one source and aren't
representative of the user's broader interests.

`summarize_interests` feeds those raw queries to an LLM and returns a
one-or-two-sentence interest profile suitable as the query string for
a subsequent `rag_service.search(..., source_type="events")` call.

Both functions are defensive: any error reading a thread's state or
invoking the LLM is logged and swallowed so a single bad thread never
poisons the whole recommendation response.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from app.core.logging import get_logger
from app.core.thread_store import list_threads
from app.suggestions.starter import _extract_response_text

log = get_logger(__name__)

_DAY_SECONDS = 86400

# Bound how many threads we read per request. A user with 100 threads
# in the last 7 days shouldn't mean 100 checkpointer round-trips —
# the most recent 20 are a good enough sample of current interests.
_MAX_THREADS_PER_HARVEST = 20

# Bound how many queries we feed to the summary LLM. After dedup,
# keeping the most recent N avoids blowing the prompt budget when a
# single active thread has many turns.
_MAX_QUERIES_FOR_SUMMARY = 40


_SUMMARY_PROMPT = (
    "以下是使用者最近在法鼓山助理上的提問。請依據這些提問,"
    "用一句或兩句話,簡潔地概括使用者目前關注的主題或興趣,"
    "以便後續用這段摘要去搜尋相關的活動推薦。\n\n"
    "使用者提問:\n{queries}\n\n"
    "只輸出主題摘要本身,不要加上「使用者關注:」等前綴,"
    "也不要輸出列表或多行。用繁體中文。"
)


async def collect_recent_queries(
    user_id: str,
    *,
    days: int = 7,
    now: float | None = None,
) -> list[str]:
    """Return the user's HumanMessage texts from threads active in the window.

    Queries are ordered latest-first across threads; duplicates (same
    exact text) are kept so the LLM sees frequency, which is often a
    signal of salience.
    """
    from app.agent import graph as agent_module

    cutoff = (now or time.time()) - days * _DAY_SECONDS
    threads = await list_threads(user_id)
    recent = sorted(
        (t for t in threads if t.get("created_at", 0) >= cutoff),
        key=lambda t: t.get("created_at", 0),
        reverse=True,
    )[:_MAX_THREADS_PER_HARVEST]

    if not recent:
        return []

    agent_graph = agent_module.agent_graph
    if agent_graph is None:
        log.warning("collect_recent_queries | agent graph not initialised")
        return []

    queries: list[str] = []
    for thread in recent:
        thread_id = thread["thread_id"]
        try:
            state = await agent_graph.aget_state({"configurable": {"thread_id": thread_id}})
        except Exception:
            log.exception("collect_recent_queries | aget_state failed | thread=%s", thread_id)
            continue

        values = getattr(state, "values", None) or {}
        for msg in values.get("messages", []) or []:
            if getattr(msg, "type", None) != "human":
                continue
            text = _message_text(msg.content).strip()
            if text:
                queries.append(text)

    if len(queries) > _MAX_QUERIES_FOR_SUMMARY:
        queries = queries[:_MAX_QUERIES_FOR_SUMMARY]
    return queries


async def summarize_interests(
    queries: list[str],
    *,
    chat_model: Any | None = None,
) -> str:
    """LLM-summarize `queries` into a short interest profile.

    Returns "" on any failure or if `queries` is empty so the caller
    can fall through to an empty-recommendations response without
    special-casing error handling.
    """
    if not queries:
        return ""

    try:
        model = chat_model or _build_chat_model()
        prompt = _SUMMARY_PROMPT.format(
            queries="\n".join(f"- {q}" for q in queries),
        )
        return await asyncio.to_thread(_invoke_sync, model, prompt)
    except Exception:
        log.exception("summarize_interests | LLM invocation failed")
        return ""


def _invoke_sync(chat_model: Any, prompt: str) -> str:
    from langchain_core.messages import HumanMessage

    response = chat_model.invoke([HumanMessage(content=prompt)])
    return _extract_response_text(response).strip()


def _build_chat_model() -> Any:
    # Same vendor/model as the starter/follow-up suggest pool — the
    # recommendation profile is also a short natural-language output,
    # so reusing the same LLM role keeps the env surface flat.
    from app.suggestions.starter import build_suggest_chat_model

    return build_suggest_chat_model()


def _message_text(content: Any) -> str:
    """Flatten a LangChain message content to plain text.

    HumanMessage.content is usually a string, but certain clients (and
    our own synthetic quiz-grading turn) emit a list of content parts.
    """
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
