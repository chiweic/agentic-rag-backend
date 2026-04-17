"""Follow-up suggestions — proposed next questions for the latest turn.

Called from the `/threads/{id}/runs/stream` handler after the assistant
reply settles, only when the turn produced citations (grounded answer).
Returns up to `n` short prompts the user might ask next; the handler
emits them as an SSE `suggestions/final` event so the frontend can
render them under the last assistant message.

Kept defensive: any failure (LLM error, bad response shape) returns an
empty list rather than raising. The answer is already delivered; we
don't want follow-up generation to poison the stream.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

from app.core.logging import get_logger
from app.suggestions.starter import (
    _extract_response_text,
    _suggestion_id,
    build_suggest_chat_model,
)

log = get_logger(__name__)


async def generate_followups(
    question: str,
    answer: str,
    *,
    n: int = 3,
    chat_model: Any | None = None,
) -> list[dict[str, str]]:
    """Propose up to `n` follow-up prompts. Returns `[{"id","text"}, ...]`.

    Never raises: swallows exceptions and returns `[]` on failure so the
    SSE stream keeps flowing even when the suggest LLM is flaky.
    """
    if not question or not answer or n <= 0:
        return []
    try:
        model = chat_model or build_suggest_chat_model()
        return await asyncio.to_thread(_run_sync, model, question, answer, n)
    except Exception:  # noqa: BLE001
        log.exception("followup-suggestions | generation failed")
        return []


def _run_sync(chat_model: Any, question: str, answer: str, n: int) -> list[dict[str, str]]:
    from langchain_core.messages import HumanMessage

    prompt = (
        "A user asked a question and got the following answer. Propose "
        f"exactly {n} short follow-up questions the user might ask next.\n\n"
        "Guidelines:\n"
        "- Under 12 words each.\n"
        "- Same language as the user's question.\n"
        "- Return one per line. No numbering, no bullets, no quotes.\n\n"
        f"User question:\n{question.strip()}\n\n"
        f"Assistant answer:\n{answer.strip()}\n"
    )
    response = chat_model.invoke([HumanMessage(content=prompt)])
    text = _extract_response_text(response)

    out: list[dict[str, str]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^\s*\d+[.)\s-]+\s*(.*)$", line)
        candidate = (m.group(1) if m else line).strip().strip('"').strip("'")
        if not candidate:
            continue
        out.append({"id": _suggestion_id(candidate), "text": candidate})
        if len(out) >= n:
            break
    return out
