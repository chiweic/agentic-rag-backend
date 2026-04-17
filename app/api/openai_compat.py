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
    from app.rag import current_rag_service

    # Ephemeral thread_id — OpenAI-compat is stateless per request
    thread_id = str(uuid.uuid4())
    source_type = None
    if request.metadata and isinstance(request.metadata, dict):
        source_type = request.metadata.get("source_type")
    config = {
        "configurable": {
            "thread_id": thread_id,
            "rag_service": current_rag_service(),
            "source_type": source_type,
        },
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
        source_type=source_type,
    )

    if request.stream:
        return StreamingResponse(
            _stream_response(state, config, request.model),
            media_type="text/event-stream",
        )

    result = await agent_module.agent_graph.ainvoke(state, config=config)
    ai_message = result["messages"][-1]
    content_text, citations = _flatten_ai_message(ai_message)
    if citations:
        content_text = _append_sources_footer(content_text, citations)
    log.info("OpenAI-compat | complete | %d chars", len(content_text))

    return OpenAIChatResponse(
        id=f"chatcmpl-{uuid.uuid4().hex[:12]}",
        created=int(time.time()),
        model=request.model,
        choices=[
            OpenAIChoice(
                message=OpenAIMessage(role="assistant", content=content_text),
            )
        ],
        usage=OpenAIUsage(),
    )


def _flatten_ai_message(msg: AIMessage) -> tuple[str, list[dict]]:
    """Extract text + citation blocks from a potentially-multi-block AIMessage."""
    content = msg.content
    if isinstance(content, str):
        return content, []
    text_parts: list[str] = []
    citations: list[dict] = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict):
                btype = block.get("type")
                if btype == "text":
                    text_parts.append(str(block.get("text", "")))
                elif btype == "citations":
                    citations = list(block.get("citations", []))
            elif isinstance(block, str):
                text_parts.append(block)
    return "".join(text_parts), citations


def _append_sources_footer(text: str, citations: list[dict]) -> str:
    lines = [text.rstrip(), "", "Sources:"]
    for c in citations:
        title = c.get("title") or c.get("chunk_id") or ""
        url = c.get("source_url") or ""
        lines.append(f"- {title} ({url})" if url else f"- {title}")
    return "\n".join(lines)


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

    emitted_content = False
    final_ai_message: AIMessage | None = None
    async for event in agent_module.agent_graph.astream_events(state, config=config, version="v2"):
        kind = event["event"]
        if kind == "on_chat_model_stream":
            chunk: AIMessageChunk = event["data"]["chunk"]
            if chunk.content:
                emitted_content = True
                stream_chunk = OpenAIChatStreamChunk(
                    id=completion_id,
                    created=created,
                    model=model,
                    choices=[OpenAIStreamChoice(delta=OpenAIDelta(content=chunk.content))],
                )
                yield f"data: {stream_chunk.model_dump_json()}\n\n"
        elif kind == "on_chain_end" and event.get("name") == "LangGraph":
            output = event.get("data", {}).get("output")
            if isinstance(output, dict):
                messages = output.get("messages") or []
                for msg in reversed(messages):
                    if isinstance(msg, AIMessage):
                        final_ai_message = msg
                        break

    # Emit citations. When tokens streamed (emitted_content=True) we only
    # need the footer; when no streaming fired (RAG provider used .invoke),
    # synthesize the full body plus footer from the final AIMessage.
    if final_ai_message is not None:
        text, citations = _flatten_ai_message(final_ai_message)
        if not emitted_content and text:
            synth_chunk = OpenAIChatStreamChunk(
                id=completion_id,
                created=created,
                model=model,
                choices=[
                    OpenAIStreamChoice(
                        delta=OpenAIDelta(
                            content=_append_sources_footer(text, citations) if citations else text
                        )
                    )
                ],
            )
            yield f"data: {synth_chunk.model_dump_json()}\n\n"
        elif emitted_content and citations:
            footer_lines = ["", "", "Sources:"]
            for c in citations:
                title = c.get("title") or c.get("chunk_id") or ""
                url = c.get("source_url") or ""
                footer_lines.append(f"- {title} ({url})" if url else f"- {title}")
            footer_chunk = OpenAIChatStreamChunk(
                id=completion_id,
                created=created,
                model=model,
                choices=[OpenAIStreamChoice(delta=OpenAIDelta(content="\n".join(footer_lines)))],
            )
            yield f"data: {footer_chunk.model_dump_json()}\n\n"

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
