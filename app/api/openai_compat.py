"""OpenAI-compatible /v1/chat/completions endpoint.

Allows Open WebUI and other OpenAI-compatible clients to connect.
Routes requests through the same LangGraph agent with Langfuse tracing.
"""

import time
import uuid

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, SystemMessage

from app.agent import graph as agent_module
from app.agent.state import AgentState
from app.api.schemas import (
    OpenAIChatRequest,
    OpenAIChatResponse,
    OpenAIChatStreamChunk,
    OpenAIChoice,
    OpenAIDelta,
    OpenAIMessage,
    OpenAIStreamChoice,
    OpenAIUsage,
)
from app.core.logging import get_logger
from app.core.tracing import get_langfuse_config

log = get_logger(__name__)
router = APIRouter(prefix="/v1", tags=["openai-compat"])


def _to_langchain_messages(messages: list[OpenAIMessage]):
    lc_messages = []
    for m in messages:
        if m.role == "user":
            lc_messages.append(HumanMessage(content=m.content))
        elif m.role == "assistant":
            lc_messages.append(AIMessage(content=m.content))
        elif m.role == "system":
            lc_messages.append(SystemMessage(content=m.content))
    return lc_messages


@router.post("/chat/completions")
async def chat_completions(request: OpenAIChatRequest):
    # Ephemeral thread_id — OpenAI-compat is stateless per request
    thread_id = str(uuid.uuid4())
    config = {
        "configurable": {"thread_id": thread_id},
        **get_langfuse_config(
            user_id=request.user,
            trace_name="openai-compat-chat",
        ),
    }

    user_msg = next((m.content for m in request.messages if m.role == "user"), "")
    log.info(
        "OpenAI-compat | model=%s stream=%s user=%s | %s",
        request.model,
        request.stream,
        request.user,
        user_msg[:80],
    )

    state = AgentState(
        messages=_to_langchain_messages(request.messages),
        user_id=request.user,
    )

    if request.stream:
        return StreamingResponse(
            _stream_response(state, config, request.model),
            media_type="text/event-stream",
        )

    result = await agent_module.agent_graph.ainvoke(state, config=config)
    ai_message = result["messages"][-1]
    log.info("OpenAI-compat | complete | %d chars", len(ai_message.content))

    return OpenAIChatResponse(
        id=f"chatcmpl-{uuid.uuid4().hex[:12]}",
        created=int(time.time()),
        model=request.model,
        choices=[
            OpenAIChoice(
                message=OpenAIMessage(role="assistant", content=ai_message.content),
            )
        ],
        usage=OpenAIUsage(),
    )


async def _stream_response(state: AgentState, config: dict, model: str):
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created = int(time.time())

    first_chunk = OpenAIChatStreamChunk(
        id=completion_id,
        created=created,
        model=model,
        choices=[OpenAIStreamChoice(delta=OpenAIDelta(role="assistant", content=""))],
    )
    yield f"data: {first_chunk.model_dump_json()}\n\n"

    async for event in agent_module.agent_graph.astream_events(state, config=config, version="v2"):
        if event["event"] == "on_chat_model_stream":
            chunk: AIMessageChunk = event["data"]["chunk"]
            if chunk.content:
                stream_chunk = OpenAIChatStreamChunk(
                    id=completion_id,
                    created=created,
                    model=model,
                    choices=[OpenAIStreamChoice(delta=OpenAIDelta(content=chunk.content))],
                )
                yield f"data: {stream_chunk.model_dump_json()}\n\n"

    final_chunk = OpenAIChatStreamChunk(
        id=completion_id,
        created=created,
        model=model,
        choices=[OpenAIStreamChoice(delta=OpenAIDelta(), finish_reason="stop")],
    )
    yield f"data: {final_chunk.model_dump_json()}\n\n"
    yield "data: [DONE]\n\n"


@router.get("/models")
async def list_models():
    """Minimal /v1/models endpoint for client discovery."""
    return {
        "object": "list",
        "data": [
            {
                "id": "agentic-rag",
                "object": "model",
                "created": int(time.time()),
                "owned_by": "local",
            }
        ],
    }
