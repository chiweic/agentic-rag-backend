"""Suggestion generation — starter prompts and follow-up ideas.

Starter suggestions are pre-generated at startup from the latest
`rag_bot_qa_*` Milvus collection, rephrased via `SUGGEST_LLM` (falling
back to `GEN_LLM` when unset) into casual first-person prompts, and
cached in-process. A random subset is served per request so different
page loads see different prompts without paying per-call LLM cost.

Follow-up suggestions are generated per assistant turn from the last
question + answer and fed into the SSE stream as a `suggestions/final`
event on `/threads/{id}/runs/stream`.

See `docs/features_v1.md` for the full milestone-1 spec.
"""

from app.suggestions.starter import (
    StarterStatus,
    StarterSuggestionsPool,
    Suggestion,
)

__all__ = ["StarterStatus", "StarterSuggestionsPool", "Suggestion"]
