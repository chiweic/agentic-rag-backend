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
import time
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import (
    AIMessage,
    AIMessageChunk,
    HumanMessage,
    SystemMessage,
    messages_to_dict,
)
from pydantic import BaseModel, Field

from app.agent import graph as agent_module
from app.core.logging import get_logger
from app.core.tracing import get_langfuse_config, get_trace_id

log = get_logger(__name__)
router = APIRouter(tags=["threads"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ThreadCreateRequest(BaseModel):
    metadata: dict = Field(default_factory=dict)


class ThreadResponse(BaseModel):
    thread_id: str
    created_at: float = 0
    metadata: dict = Field(default_factory=dict)


class RunStreamRequest(BaseModel):
    input: dict | None = None
    command: dict | None = None
    stream_mode: list[str] = Field(default=["messages", "updates"], alias="streamMode")
    metadata: dict = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


# ---------------------------------------------------------------------------
# In-memory thread metadata (lightweight — checkpointer handles state)
# ---------------------------------------------------------------------------
_thread_metadata: dict[str, dict] = {}


# ---------------------------------------------------------------------------
# POST /threads
# ---------------------------------------------------------------------------
@router.post("/threads")
async def create_thread(request: ThreadCreateRequest | None = None):
    thread_id = str(uuid.uuid4())
    created_at = time.time()
    metadata = request.metadata if request else {}
    _thread_metadata[thread_id] = {"metadata": metadata, "created_at": created_at}
    log.info("Thread created: %s", thread_id)
    return ThreadResponse(thread_id=thread_id, created_at=created_at, metadata=metadata)


# ---------------------------------------------------------------------------
# GET /threads — list all threads (for sidebar)
# ---------------------------------------------------------------------------
@router.get("/threads")
async def list_threads():
    threads = []
    for tid, info in _thread_metadata.items():
        # Fetch first user message as preview
        config = {"configurable": {"thread_id": tid}}
        state = await agent_module.agent_graph.aget_state(config)
        title = None
        if state.values:
            for msg in state.values.get("messages", []):
                if msg.type == "human":
                    title = msg.content[:80]
                    break
        threads.append({
            "thread_id": tid,
            "title": title,
            "created_at": info["created_at"],
            "metadata": info["metadata"],
        })
    # Newest first
    threads.sort(key=lambda t: t["created_at"], reverse=True)
    log.info("Listed %d threads", len(threads))
    return threads


# ---------------------------------------------------------------------------
# DELETE /threads/{thread_id}
# ---------------------------------------------------------------------------
@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str):
    if thread_id in _thread_metadata:
        del _thread_metadata[thread_id]
    log.info("Thread deleted: %s", thread_id)
    return {"status": "deleted", "thread_id": thread_id}


# ---------------------------------------------------------------------------
# GET /threads/{thread_id}/state
# ---------------------------------------------------------------------------
@router.get("/threads/{thread_id}/state")
async def get_thread_state(thread_id: str):
    config = {"configurable": {"thread_id": thread_id}}
    state = await agent_module.agent_graph.aget_state(config)

    if state.values:
        messages = state.values.get("messages", [])
        messages_serialized = messages_to_dict(messages)
    else:
        messages_serialized = []

    return {
        "values": {"messages": messages_serialized},
        "tasks": [],
    }


# ---------------------------------------------------------------------------
# POST /threads/{thread_id}/runs/stream
# ---------------------------------------------------------------------------
@router.post("/threads/{thread_id}/runs/stream")
async def run_stream(thread_id: str, request: RunStreamRequest):
    """Stream agent execution in LangGraph Cloud SSE format.

    The @langchain/langgraph-sdk expects SSE events with format:
        event: <event_type>
        data: <json_payload>

    Event types: messages/partial, messages/complete, values, updates, end
    """
    # Build messages from input or command
    input_messages = None
    if request.input and "messages" in request.input:
        raw_messages = request.input["messages"]
        input_messages = _parse_input_messages(raw_messages)

    preview = input_messages[-1].content[:80] if input_messages else "(command)"
    log.info("Thread %s | run started | %s", thread_id[:8], preview)

    langfuse_config = get_langfuse_config(
        user_id=request.metadata.get("user_id"),
        session_id=thread_id,
        trace_name="thread-run",
        tags=["thread"],
    )

    config = {
        "configurable": {"thread_id": thread_id},
        **langfuse_config,
    }

    return StreamingResponse(
        _stream_events(input_messages, config, request.command),
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


async def _stream_events(input_messages: list | None, config: dict, command: dict | None):
    """Stream in LangGraph Cloud format for @langchain/langgraph-sdk."""

    invoke_input = {"messages": input_messages} if input_messages else None

    # Stream using astream_events for fine-grained control
    accumulated_content = ""
    ai_message_id = str(uuid.uuid4())

    async for event in agent_module.agent_graph.astream_events(
        invoke_input, config=config, version="v2"
    ):
        kind = event["event"]

        if kind == "on_chat_model_stream":
            chunk: AIMessageChunk = event["data"]["chunk"]
            if chunk.content:
                accumulated_content += chunk.content
                # messages/partial — the frontend accumulates these
                partial_msg = {
                    "type": "ai",
                    "id": ai_message_id,
                    "content": accumulated_content,
                }
                yield f"event: messages/partial\ndata: {json.dumps([partial_msg])}\n\n"

        elif kind == "on_chat_model_end":
            ai_msg = event["data"]["output"]
            complete_msg = {
                "type": "ai",
                "id": ai_message_id,
                "content": ai_msg.content if hasattr(ai_msg, "content") else accumulated_content,
            }
            yield f"event: messages/complete\ndata: {json.dumps([complete_msg])}\n\n"

    # Final state
    state = await agent_module.agent_graph.aget_state(config)
    if state.values:
        values_messages = messages_to_dict(state.values.get("messages", []))
        yield f"event: values\ndata: {json.dumps({'messages': values_messages})}\n\n"

    thread_id = config.get("configurable", {}).get("thread_id", "?")
    log.info("Thread %s | run complete | %d chars", thread_id[:8], len(accumulated_content))
    yield f"event: end\ndata: null\n\n"
