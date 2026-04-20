"""Generate a multiple-choice quiz over the chunks of one source record.

Shape matches what `@tool-ui/question-flow`'s upfront mode expects so
the frontend can feed the response directly into `<QuestionFlow
steps={...}>` without an adapter:

```
{
  steps: [{
    id, title, description?,
    options: [{id, label, description?}],
    selectionMode: "single",
    correctOptionIds: [...],   // answer key — kept for client-side grading
    explanation?
  }]
}
```

The LLM is prompted to emit strict JSON; we parse with Pydantic and
fall back to a defensive empty quiz rather than raising, so the HTTP
layer can decide how to surface the failure.
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.logging import get_logger
from app.rag.protocol import RetrievalHit
from app.suggestions.starter import _extract_response_text, build_suggest_chat_model

log = get_logger(__name__)


class QuizOption(BaseModel):
    id: str
    label: str
    description: str | None = None


class QuizQuestion(BaseModel):
    id: str
    title: str
    description: str | None = None
    options: list[QuizOption]
    selectionMode: Literal["single"] = "single"
    correctOptionIds: list[str] = Field(default_factory=list)
    explanation: str | None = None


class Quiz(BaseModel):
    steps: list[QuizQuestion]


async def generate_quiz(
    hits: list[RetrievalHit],
    *,
    n: int = 4,
    chat_model: Any | None = None,
) -> Quiz:
    """Generate an `n`-question quiz grounded in the given chunks.

    Returns `Quiz(steps=[])` on any failure so the API layer can 404/503
    gracefully. Runs the sync LLM call off the event loop.
    """
    if not hits or n <= 0:
        return Quiz(steps=[])
    try:
        model = chat_model or build_suggest_chat_model()
        return await asyncio.to_thread(_run_sync, model, hits, n)
    except Exception:  # noqa: BLE001
        log.exception("quiz | generation failed")
        return Quiz(steps=[])


_SYSTEM_PROMPT = (
    "You are a quiz author. Produce a short multiple-choice quiz grounded "
    "strictly in the provided source. Respond with a single JSON object — "
    "no prose, no markdown fences, nothing outside the JSON.\n\n"
    "Schema:\n"
    "{\n"
    '  "steps": [{\n'
    '    "id": string,              // stable slug, e.g. "q1"\n'
    '    "title": string,           // question stem\n'
    '    "description": string?,    // optional layer label: 事實 / 理解 / 應用\n'
    '    "options": [{ "id": string, "label": string, "description": string? }],\n'
    '    "selectionMode": "single",\n'
    '    "correctOptionIds": [string],  // exactly one option id\n'
    '    "explanation": string       // why that option is correct, tied to the source\n'
    "  }]\n"
    "}\n\n"
    "Rules:\n"
    "- Exactly 4 options per question, one correct.\n"
    "- Option ids must be one of: a, b, c, d.\n"
    "- Mix of fact (事實), understanding (理解), and application (應用) layers.\n"
    "- Use Traditional Chinese for all human-readable text.\n"
    "- Do NOT invent facts that are not in the source.\n"
)


def _run_sync(chat_model: Any, hits: list[RetrievalHit], n: int) -> Quiz:
    from langchain_core.messages import HumanMessage

    body = "\n\n".join(h.text for h in hits if h.text)
    handle = _source_handle(hits)

    user_prompt = (
        f"{_SYSTEM_PROMPT}\n"
        f"Generate exactly {n} questions.\n"
        f"Source: {handle}\n"
        f"Source content:\n{body}\n"
    )
    response = chat_model.invoke([HumanMessage(content=user_prompt)])
    text = _extract_response_text(response)

    payload = _extract_json_object(text)
    if payload is None:
        log.warning("quiz | LLM response was not valid JSON; got %r", text[:200])
        return Quiz(steps=[])
    quiz = Quiz.model_validate(payload)
    return _normalize_ids(quiz)


def _source_handle(hits: list[RetrievalHit]) -> str:
    meta = hits[0].metadata if hits else {}
    parts = [
        meta.get("book_title"),
        meta.get("chapter_title"),
        hits[0].title if hits else None,
    ]
    return " · ".join(p for p in parts if p) or (hits[0].title if hits else "")


_JSON_BLOCK = re.compile(r"\{[\s\S]*\}")


def _extract_json_object(text: str) -> dict | None:
    """Pull the first `{...}` JSON object out of `text`, tolerating fences."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        m = _JSON_BLOCK.search(stripped)
        if not m:
            return None
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            return None


def _normalize_ids(quiz: Quiz) -> Quiz:
    """Guarantee each step has a unique non-empty id for React keys.

    The LLM almost always supplies sane ids (q1/q2/…), but a defensive
    fallback keeps the frontend happy if it drifts.
    """
    seen: set[str] = set()
    for idx, step in enumerate(quiz.steps):
        if not step.id or step.id in seen:
            step.id = f"q{idx + 1}_{uuid.uuid4().hex[:6]}"
        seen.add(step.id)
    return quiz
