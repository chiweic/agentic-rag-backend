"""Multi-source hit merger used by the agent retrieve node and the
/recommendations endpoint.

Videos come before audio in the final ordering — the 聖嚴師父身影 tab
uses this helper with source types `video_ddmtv01`, `video_ddmtv02`,
and `audio`, and users expect video cards at the top of the grid
(they're visually richer) followed by audio cards.

Within each modality group, sources are round-robin interleaved so
every in-group source stays represented regardless of cross-corpus
score drift.
"""

from __future__ import annotations

from typing import TypeVar

T = TypeVar("T")

_VIDEO_PREFIX = "video"
_AUDIO_NAME = "audio"


def merge_with_modality_priority(
    per_source_hits: dict[str, list[T]],
    source_types: list[str],
    *,
    limit: int,
) -> list[T]:
    """Round-robin within modality groups, then concatenate groups in
    priority order: videos → audio → everything else.

    `per_source_hits` maps each source name to its top-k hits. The
    ordering inside each source's list is preserved (usually by score).
    The function returns at most `limit` hits.
    """
    video = [s for s in source_types if s.startswith(_VIDEO_PREFIX)]
    audio = [s for s in source_types if s == _AUDIO_NAME]
    other = [s for s in source_types if s not in video and s not in audio]

    merged: list[T] = []
    for group in (video, audio, other):
        merged.extend(_round_robin(per_source_hits, group))
        if len(merged) >= limit:
            break
    return merged[:limit]


def _round_robin(
    per_source_hits: dict[str, list[T]],
    sources: list[str],
) -> list[T]:
    result: list[T] = []
    idx = 0
    while any(idx < len(per_source_hits.get(s, [])) for s in sources):
        for source in sources:
            per = per_source_hits.get(source, [])
            if idx < len(per):
                result.append(per[idx])
        idx += 1
    return result
