"""LangGraph Cloud-compatible thread & run endpoints.

These endpoints match the format expected by @langchain/langgraph-sdk Client
and @assistant-ui/react-langgraph runtime:
    POST   /threads                    — create thread
    GET    /threads                    — list threads (for sidebar)
    GET    /threads/{id}/state         — get thread state (messages)
    POST   /threads/{id}/runs/stream   — run agent & stream response
    DELETE /threads/{id}               — delete thread
"""

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
)
from pydantic import BaseModel, Field

from app.agent import graph as agent_module
from app.api.normalize import normalize_messages, text_part
from app.core import thread_store
from app.core.auth import UserClaims, get_current_user
from app.core.logging import get_logger
from app.core.tracing import get_langfuse_config
from app.suggestions.followup import generate_followups

log = get_logger(__name__)
router = APIRouter(tags=["threads"])


# ---------------------------------------------------------------------------
# Schemas
# add comment as example on cicd verification
# ---------------------------------------------------------------------------
class ThreadCreateRequest(BaseModel):
    metadata: dict = Field(default_factory=dict)


class ThreadUpdateRequest(BaseModel):
    title: str | None = None
    is_archived: bool | None = None
    metadata: dict | None = None


class ThreadResponse(BaseModel):
    thread_id: str
    title: str | None = None
    created_at: float = 0
    is_archived: bool = False
    metadata: dict = Field(default_factory=dict)


class RunStreamRequest(BaseModel):
    input: dict | None = None
    command: dict | None = None
    stream_mode: list[str] = Field(default=["messages", "updates"], alias="streamMode")
    metadata: dict = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


async def _get_thread_or_404_403(thread_id: str, user_sub: str) -> dict:
    info = await thread_store.get_thread(thread_id)
    if info is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    if info.get("user_id") != user_sub:
        raise HTTPException(status_code=403, detail="Forbidden")
    return info


# ---------------------------------------------------------------------------
# POST /threads
# ---------------------------------------------------------------------------
@router.post("/threads")
async def create_thread(
    request: ThreadCreateRequest | None = None,
    user: UserClaims = Depends(get_current_user),
):
    metadata = request.metadata if request else {}
    info = await thread_store.create_thread(user_id=user.user_id, metadata=metadata)
    # Remove user_id from the public response, it is an internal implementation detail
    info.pop("user_id", None)
    return ThreadResponse(**info)


# ---------------------------------------------------------------------------
# GET /threads — list all threads (for sidebar)
# ---------------------------------------------------------------------------
@router.get("/threads")
async def list_threads(user: UserClaims = Depends(get_current_user)):
    threads = await thread_store.list_threads(user_id=user.user_id)

    log.info("Listed %d threads for user %s", len(threads), user.user_id)
    # Strip user_id from output
    for t in threads:
        t.pop("user_id", None)
    return threads


# ---------------------------------------------------------------------------
# DELETE /threads/{thread_id}
# ---------------------------------------------------------------------------
@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str, user: UserClaims = Depends(get_current_user)):
    await _get_thread_or_404_403(thread_id, user.user_id)

    # Wipe both metadata and checkpointer state so the thread cannot be resumed
    await thread_store.delete_thread(thread_id, user_id=user.user_id)
    checkpointer = agent_module.agent_graph.checkpointer
    if checkpointer is not None:
        await checkpointer.adelete_thread(thread_id)
    log.info("Thread %s | metadata + checkpoint deleted", thread_id[:8])
    return {"status": "deleted", "thread_id": thread_id}


# ---------------------------------------------------------------------------
# PATCH /threads/{thread_id} — rename, archive/unarchive, update metadata
# ---------------------------------------------------------------------------
@router.patch("/threads/{thread_id}")
async def update_thread(
    thread_id: str,
    request: ThreadUpdateRequest,
    user: UserClaims = Depends(get_current_user),
):
    await _get_thread_or_404_403(thread_id, user.user_id)

    kwargs: dict = {}
    if request.title is not None:
        kwargs["title"] = request.title
    if request.is_archived is not None:
        kwargs["is_archived"] = request.is_archived
    if request.metadata is not None:
        kwargs["metadata"] = request.metadata

    info = await thread_store.update_thread(thread_id, user_id=user.user_id, **kwargs)
    if info is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    info.pop("user_id", None)
    log.info(
        "Thread updated: %s | title=%s archived=%s",
        thread_id[:8],
        info.get("title"),
        info.get("is_archived"),
    )
    return info


# ---------------------------------------------------------------------------
# POST /threads/{thread_id}/generate-title — LLM-generated title
# ---------------------------------------------------------------------------
@router.post("/threads/{thread_id}/generate-title")
async def generate_title(thread_id: str, user: UserClaims = Depends(get_current_user)):
    await _get_thread_or_404_403(thread_id, user.user_id)

    # Get first user message
    config = {"configurable": {"thread_id": thread_id}}
    state = await agent_module.agent_graph.aget_state(config)

    first_user_msg = None
    if state.values:
        for msg in state.values.get("messages", []):
            if msg.type == "human":
                first_user_msg = msg.content
                break

    if not first_user_msg:
        raise HTTPException(status_code=400, detail="Thread has no user messages")

    # Use the same LLM to generate a short title
    from langchain_core.messages import HumanMessage as HM
    from langchain_core.messages import SystemMessage as SM

    from app.agent.nodes import generate_title_llm

    llm = generate_title_llm()
    response = llm.invoke(
        [
            SM(
                content=(
                    "Generate a short title (max 6 words) for this conversation."
                    " Return only the title, no quotes or punctuation."
                )
            ),
            HM(content=first_user_msg),
        ]
    )
    title = response.content.strip()[:80]

    await thread_store.update_thread(thread_id, user_id=user.user_id, title=title)
    log.info("Thread %s | generated title: %s", thread_id[:8], title)
    return {"thread_id": thread_id, "title": title}


# ---------------------------------------------------------------------------
# GET /threads/{thread_id}/state
# ---------------------------------------------------------------------------
@router.get("/threads/{thread_id}/state")
async def get_thread_state(thread_id: str, user: UserClaims = Depends(get_current_user)):
    await _get_thread_or_404_403(thread_id, user.user_id)

    config = {"configurable": {"thread_id": thread_id}}
    state = await agent_module.agent_graph.aget_state(config)

    if state.values:
        messages = state.values.get("messages", [])
    else:
        messages = []

    return {
        "thread_id": thread_id,
        "messages": normalize_messages(messages),
    }


# ---------------------------------------------------------------------------
# POST /threads/{thread_id}/runs/stream
# ---------------------------------------------------------------------------
@router.post("/threads/{thread_id}/runs/stream")
async def run_stream(
    thread_id: str,
    request: RunStreamRequest,
    user: UserClaims = Depends(get_current_user),
):
    """Stream agent execution in LangGraph Cloud SSE format.

    The @langchain/langgraph-sdk expects SSE events with format:
        event: <event_type>
        data: <json_payload>

    Event types: messages/partial, messages/complete, values, updates, end
    """
    info = await _get_thread_or_404_403(thread_id, user.user_id)

    # Build messages from input or command
    input_messages = None
    if request.input and "messages" in request.input:
        raw_messages = request.input["messages"]
        input_messages = _parse_input_messages(raw_messages)

    preview = input_messages[-1].content[:80] if input_messages else "(command)"
    log.info("Thread %s | run started | %s", thread_id[:8], preview)

    # Backfill title from the first user message when none was set explicitly.
    # Done once per thread — subsequent runs find title already set.
    if not info.get("title") and input_messages:
        first_user_msg = next((m for m in input_messages if isinstance(m, HumanMessage)), None)
        if first_user_msg is not None:
            await thread_store.update_thread(
                thread_id,
                user_id=user.user_id,
                title=first_user_msg.content[:80],
            )

    langfuse_config = get_langfuse_config(
        user_id=user.user_id,
        session_id=thread_id,
        trace_name="thread-run",
        tags=["thread"],
    )

    source_type = None
    if request.metadata and isinstance(request.metadata, dict):
        source_type = request.metadata.get("source_type")

    from app.rag import current_rag_service

    config = {
        "configurable": {
            "thread_id": thread_id,
            "rag_service": current_rag_service(),
            "source_type": source_type,
        },
        **langfuse_config,
    }

    return StreamingResponse(
        _stream_events(input_messages, config, request.command, source_type=source_type),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def _parse_input_messages(raw_messages: list) -> list:
    """Convert various message formats to LangChain message objects."""
    lc_messages = []
    for m in raw_messages:
        if isinstance(m, dict):
            role = m.get("role", m.get("type", "user"))
            content = m.get("content", "")
        else:
            continue

        if role in ("user", "human"):
            lc_messages.append(HumanMessage(content=content))
        elif role in ("assistant", "ai"):
            lc_messages.append(AIMessage(content=content))
        elif role == "system":
            lc_messages.append(SystemMessage(content=content))
    return lc_messages


async def _stream_events(
    input_messages: list | None,
    config: dict,
    command: dict | None,
    *,
    source_type: str | None = None,
):
    """Stream in normalized SSE format.

    Event sequence:
        messages/partial   — running accumulation (replace-on-chunk, not delta)
        messages/complete  — final assistant message after LLM finishes
        values             — full normalized thread state
        suggestions/final  — follow-up prompts (only when the turn is grounded)
        error              — emitted on exception before the stream closes
        end                — final sentinel

    Payload shapes use the normalized message form:
        {"id": "...", "role": "assistant", "content": [{"type":"text","text":"..."}]}
    """
    if input_messages:
        invoke_input: dict | None = {"messages": input_messages}
        if source_type:
            invoke_input["source_type"] = source_type
    else:
        invoke_input = None

    accumulated_content = ""
    ai_message_id = str(uuid.uuid4())
    thread_id = config.get("configurable", {}).get("thread_id", "?")

    try:
        async for event in agent_module.agent_graph.astream_events(
            invoke_input, config=config, version="v2"
        ):
            kind = event["event"]

            if kind == "on_chat_model_stream":
                chunk: AIMessageChunk = event["data"]["chunk"]
                if chunk.content:
                    accumulated_content += chunk.content
                    # messages/partial — running accumulation; frontend replaces each tick
                    partial_msg = {
                        "id": ai_message_id,
                        "role": "assistant",
                        "content": text_part(accumulated_content),
                    }
                    yield f"event: messages/partial\ndata: {json.dumps(partial_msg)}\n\n"

            elif kind == "on_chat_model_end":
                ai_msg = event["data"]["output"]
                final_text = ai_msg.content if hasattr(ai_msg, "content") else accumulated_content
                complete_msg = {
                    "id": ai_message_id,
                    "role": "assistant",
                    "content": text_part(final_text),
                }
                yield f"event: messages/complete\ndata: {json.dumps(complete_msg)}\n\n"

        # Final state after the run settles
        state = await agent_module.agent_graph.aget_state(config)
        raw_messages = state.values.get("messages", []) if state.values else []
        values_messages = normalize_messages(raw_messages)

        # Align the assistant message id across partial/complete/values
        # events. `messages/partial` streams with `ai_message_id` (our own
        # uuid) while `normalize_messages` pulls LangChain's
        # auto-generated AIMessage.id from the checkpointer — different
        # ids for the same logical message make assistant-ui remount the
        # component on the values event, replaying the entry animation
        # (shows up as a visible "refresh" when citations appear).
        if values_messages:
            last = values_messages[-1]
            if last.get("role") == "assistant":
                last["id"] = ai_message_id

                # SSE contract guarantees at least one `messages/partial`
                # and one `messages/complete` for the final assistant
                # reply. When the underlying chat model is non-streaming
                # (RAG provider wraps a single `.invoke` call),
                # `on_chat_model_stream` may not have fired. Synthesize
                # the pair from the final normalized assistant message so
                # consumers see a consistent event sequence.
                if accumulated_content == "":
                    final_msg = {
                        "id": ai_message_id,
                        "role": "assistant",
                        "content": last.get("content", []),
                    }
                    yield f"event: messages/partial\ndata: {json.dumps(final_msg)}\n\n"
                    yield f"event: messages/complete\ndata: {json.dumps(final_msg)}\n\n"

        # Kick off follow-up suggestions in parallel with the `values`
        # event so we don't extend time-to-first-answer. Grounded answers
        # only: if the last assistant message has no citations block, skip
        # — under a no-hits fallback there's no useful follow-up direction.
        followup_task = _maybe_start_followups(input_messages, raw_messages)

        payload = {"thread_id": thread_id, "messages": values_messages}
        yield f"event: values\ndata: {json.dumps(payload)}\n\n"

        if followup_task is not None:
            try:
                followups = await followup_task
            except Exception:  # noqa: BLE001
                log.exception("Thread %s | followup generation failed", thread_id[:8])
                followups = []
            if followups:
                suggestions_payload = {"suggestions": followups}
                yield (f"event: suggestions/final\ndata: {json.dumps(suggestions_payload)}\n\n")
                log.info(
                    "Thread %s | emitted %d follow-up suggestions",
                    thread_id[:8],
                    len(followups),
                )

    except Exception as exc:  # noqa: BLE001
        log.exception("Thread %s | run failed", thread_id[:8])
        error_payload = {"message": str(exc) or exc.__class__.__name__}
        yield f"event: error\ndata: {json.dumps(error_payload)}\n\n"
        yield "event: end\ndata: null\n\n"
        return

    log.info("Thread %s | run complete | %d chars", thread_id[:8], len(accumulated_content))
    yield "event: end\ndata: null\n\n"


def _maybe_start_followups(
    input_messages: list | None,
    raw_messages: list,
):
    """Return an asyncio Task producing follow-up suggestions, or None.

    Returns None when the last assistant message isn't grounded (no
    non-empty citations block) — no follow-ups under a "no hits" fallback.
    """
    import asyncio

    from app.core.config import settings

    if not raw_messages:
        return None

    last_assistant = None
    for msg in reversed(raw_messages):
        if isinstance(msg, AIMessage):
            last_assistant = msg
            break
    if last_assistant is None:
        return None

    citations_non_empty = False
    answer_text = ""
    content = last_assistant.content
    if isinstance(content, str):
        answer_text = content
    elif isinstance(content, list):
        text_parts: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            btype = block.get("type")
            if btype == "text":
                text_parts.append(str(block.get("text", "")))
            elif btype == "citations" and block.get("citations"):
                citations_non_empty = True
        answer_text = "".join(text_parts)

    if not citations_non_empty:
        return None

    last_user = ""
    if input_messages:
        for msg in reversed(input_messages):
            if isinstance(msg, HumanMessage):
                last_user = str(msg.content)
                break
    if not last_user or not answer_text:
        return None

    return asyncio.create_task(
        generate_followups(
            last_user,
            answer_text,
            n=settings.followup_suggestions_n,
        )
    )
