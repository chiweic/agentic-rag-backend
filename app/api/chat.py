"""Chat endpoint — connects frontend to the LangGraph agent."""

import json
import uuid

from fastapi import APIRouter
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from sse_starlette.sse import EventSourceResponse

from app.agent import graph as agent_module
from app.agent.state import AgentState
from app.api.schemas import ChatMessage, ChatRequest, ChatResponse
from app.core.tracing import get_langfuse_config, get_trace_id

router = APIRouter(prefix="/api", tags=["chat"])


def _to_langchain_messages(messages: list[ChatMessage]):
    lc_messages = []
    for m in messages:
        if m.role == "user":
            lc_messages.append(HumanMessage(content=m.content))
        else:
            lc_messages.append(AIMessage(content=m.content))
    return lc_messages


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Non-streaming chat endpoint."""
    thread_id = str(uuid.uuid4())
    config = {
        "configurable": {"thread_id": thread_id},
        **get_langfuse_config(
            user_id=request.user_id,
            session_id=request.session_id,
            trace_name="agent-chat",
        ),
    }

    state = AgentState(
        messages=_to_langchain_messages(request.messages),
        user_id=request.user_id,
        session_id=request.session_id,
    )

    result = await agent_module.agent_graph.ainvoke(state, config=config)
    ai_message = result["messages"][-1]

    return ChatResponse(
        message=ChatMessage(role="assistant", content=ai_message.content),
        trace_id=get_trace_id(config),
    )


@router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """Streaming chat endpoint via SSE."""
    thread_id = str(uuid.uuid4())
    config = {
        "configurable": {"thread_id": thread_id},
        **get_langfuse_config(
            user_id=request.user_id,
            session_id=request.session_id,
            trace_name="agent-chat-stream",
        ),
    }

    state = AgentState(
        messages=_to_langchain_messages(request.messages),
        user_id=request.user_id,
        session_id=request.session_id,
    )

    async def event_generator():
        async for event in agent_module.agent_graph.astream_events(
            state, config=config, version="v2"
        ):
            if event["event"] == "on_chat_model_stream":
                chunk: AIMessageChunk = event["data"]["chunk"]
                if chunk.content:
                    yield {
                        "event": "token",
                        "data": json.dumps({"content": chunk.content}),
                    }
        yield {"event": "done", "data": json.dumps({"trace_id": get_trace_id(config)})}

    return EventSourceResponse(event_generator())
