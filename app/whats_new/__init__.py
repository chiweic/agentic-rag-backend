"""Welcome-card suggestion builder for the 新鮮事 tab (features_v4.md §1).

The flow: pull real-time news headlines via `NewsFeedProvider`, then
for each headline use the suggest LLM to draft one short dharma
"action" question grounded in the user's recent-query interest
profile. The frontend renders each card as `headline` + `action` and
sends the concatenation as a chat turn when clicked.
"""

from __future__ import annotations

from app.whats_new.enrich import (
    EnrichedSuggestion,
    build_suggestions,
)

__all__ = ["EnrichedSuggestion", "build_suggestions"]
