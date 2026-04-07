"""Normalized message shape for frontend consumption.

The backend persists LangChain `BaseMessage` objects inside the checkpointer.
This module converts them into a flat, stable shape that the frontend can
convert directly into `ThreadMessageLike[]` without touching LangChain-internal
fields.

Normalized message shape:

    {
      "id": "<string>",
      "role": "user" | "assistant" | "system" | "tool",
      "content": [{"type": "text", "text": "<string>"}, ...]
    }

For Milestone 3 the backend only emits text parts. Additional part types
(tool calls, images, attachments) will be added to the same array in a
forward-compatible way.
"""

from __future__ import annotations

from langchain_core.messages import BaseMessage

# LangChain "type" → normalized "role"
_ROLE_MAP = {
    "human": "user",
    "ai": "assistant",
    "system": "system",
    "tool": "tool",
}


def _content_to_text_parts(content) -> list[dict]:
    """Convert LangChain message content to a list of text parts.

    LangChain content can be either a string or a list of content blocks.
    For Milestone 3 we emit text parts only; non-text blocks are stringified.
    """
    if isinstance(content, str):
        return [{"type": "text", "text": content}]

    if isinstance(content, list):
        parts: list[dict] = []
        for block in content:
            if isinstance(block, str):
                parts.append({"type": "text", "text": block})
            elif isinstance(block, dict):
                # LangChain text block: {"type": "text", "text": "..."}
                if block.get("type") == "text" and isinstance(block.get("text"), str):
                    parts.append({"type": "text", "text": block["text"]})
                else:
                    # Non-text block — stringify for now
                    parts.append({"type": "text", "text": str(block)})
        return parts

    return [{"type": "text", "text": str(content)}]


def normalize_message(msg: BaseMessage) -> dict:
    """Convert a LangChain BaseMessage to the normalized shape."""
    role = _ROLE_MAP.get(msg.type, msg.type)
    return {
        "id": msg.id or "",
        "role": role,
        "content": _content_to_text_parts(msg.content),
    }


def normalize_messages(msgs: list[BaseMessage]) -> list[dict]:
    return [normalize_message(m) for m in msgs]


def text_part(text: str) -> list[dict]:
    """Build a single-text-part content array from a plain string."""
    return [{"type": "text", "text": text}]
