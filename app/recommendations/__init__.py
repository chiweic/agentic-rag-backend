"""Event recommendations (features_v2.md §4a).

Two pieces land here:
- `summarize.py` — collect the user's recent queries (default 7 days),
  LLM-summarize into an interest profile.
- Router in `app/api/recommendations.py` — wraps those two plus a
  scoped `rag_service.search(..., source_type="events")` into a single
  GET endpoint the frontend hits.
"""

from __future__ import annotations

from app.recommendations.summarize import collect_recent_queries, summarize_interests

__all__ = ["collect_recent_queries", "summarize_interests"]
