"""Pair each news headline with an LLM-generated dharma "action" question.

Single batch LLM call per request: we number the headlines, ask the
model to output one action-question per line in the same order, and
parse line-by-line. Mirrors `app/suggestions/starter.py::_batch_rephrase`
— same defensive parsing (tolerates numbering drift, falls back to a
generic action on drift).

Never raises: an LLM failure yields the generic fallback for every
headline so the `/whats-new-suggestions` endpoint can always return
something renderable.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

from app.core.logging import get_logger
from app.news.protocol import NewsHeadline
from app.suggestions.starter import (
    _extract_response_text,
    build_suggest_chat_model,
)

log = get_logger(__name__)

# Reused when the LLM can't produce a per-headline action (drift,
# error, empty response). Broad enough to be a reasonable prompt for
# almost any news topic, specific enough to steer the Sheng Yen
# answer toward pastoral guidance rather than news commentary.
_FALLBACK_ACTION = "我該如何面對這樣的情境?"


@dataclass(frozen=True)
class EnrichedSuggestion:
    """One welcome-card row: headline + dharma action + combined prompt."""

    id: str
    title: str
    source: str
    url: str | None
    action: str
    combined_prompt: str


_ACTION_SYSTEM = (
    "以下每一行是一則新聞標題。請針對每一則,提出一個簡短的佛法反思或"
    "行動問題,讓使用者藉此向法師請益。\n"
    "規則:\n"
    "- 每行輸出一個問題,順序與輸入一致。\n"
    "- 每個問題不超過 15 個字。\n"
    "- 用繁體中文。\n"
    "- 只輸出問題本身,不要編號,不要引號,不要加「行動:」等前綴。\n"
)


async def build_suggestions(
    headlines: list[NewsHeadline],
    *,
    interest_profile: str = "",
    chat_model: Any | None = None,
) -> list[EnrichedSuggestion]:
    """Enrich each headline with a dharma action + the combined prompt.

    `interest_profile` is a one-or-two-sentence summary of the user's
    recent questions. Folded into the LLM prompt so actions can lean
    toward topics the user has actually been exploring. Empty string
    is fine — the prompt still produces reasonable output from the
    headline alone.
    """
    if not headlines:
        return []

    try:
        model = chat_model or build_suggest_chat_model()
        actions = await asyncio.to_thread(_run_sync, model, headlines, interest_profile)
    except Exception:  # noqa: BLE001
        log.exception("whats_new | LLM enrichment failed")
        actions = [_FALLBACK_ACTION] * len(headlines)

    return [
        EnrichedSuggestion(
            id=h.id,
            title=h.title,
            source=h.source,
            url=h.url,
            action=a,
            combined_prompt=f"{h.title} {a}",
        )
        for h, a in zip(headlines, actions, strict=True)
    ]


def _run_sync(
    chat_model: Any,
    headlines: list[NewsHeadline],
    interest_profile: str,
) -> list[str]:
    from langchain_core.messages import HumanMessage

    numbered = "\n".join(f"{i + 1}. {h.title}" for i, h in enumerate(headlines))
    profile_block = (
        f"使用者最近在法鼓山助理上關注:{interest_profile}\n\n" if interest_profile else ""
    )
    prompt = f"{_ACTION_SYSTEM}\n{profile_block}新聞標題:\n{numbered}"
    response = chat_model.invoke([HumanMessage(content=prompt)])
    text = _extract_response_text(response)

    actions: list[str] = []
    for line in text.splitlines():
        candidate = line.strip()
        if not candidate:
            continue
        m = re.match(r"^\s*\d+[.)\s-]+\s*(.*)$", candidate)
        candidate = (m.group(1) if m else candidate).strip().strip('"').strip("'")
        if candidate:
            actions.append(candidate)

    # Tail-fallback when the LLM under-delivers so we never return
    # partial rows with empty actions.
    if len(actions) < len(headlines):
        actions.extend([_FALLBACK_ACTION] * (len(headlines) - len(actions)))
    return actions[: len(headlines)]
