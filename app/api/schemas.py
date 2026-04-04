"""Request/response schemas for the chat API."""

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    user_id: str | None = None
    session_id: str | None = None
    stream: bool = True


class ChatResponse(BaseModel):
    message: ChatMessage
    trace_id: str | None = None


# ---------------------------------------------------------------------------
# OpenAI-compatible schemas (for Open WebUI, etc.)
# ---------------------------------------------------------------------------
class OpenAIMessage(BaseModel):
    role: str
    content: str


class OpenAIChatRequest(BaseModel):
    model: str = "default"
    messages: list[OpenAIMessage]
    stream: bool = False
    temperature: float | None = None
    max_tokens: int | None = None
    user: str | None = None


class OpenAIChoice(BaseModel):
    index: int = 0
    message: OpenAIMessage
    finish_reason: str = "stop"


class OpenAIDelta(BaseModel):
    role: str | None = None
    content: str | None = None


class OpenAIStreamChoice(BaseModel):
    index: int = 0
    delta: OpenAIDelta
    finish_reason: str | None = None


class OpenAIUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class OpenAIChatResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[OpenAIChoice]
    usage: OpenAIUsage = OpenAIUsage()


class OpenAIChatStreamChunk(BaseModel):
    id: str
    object: str = "chat.completion.chunk"
    created: int
    model: str
    choices: list[OpenAIStreamChoice]
