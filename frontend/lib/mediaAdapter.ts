import type { EventRecord } from "@/lib/recommendations";

/**
 * Normalised render shape for a RetrievalHit-style record. Routes a
 * backend hit (which could come from `audio`, `video_ddmtv01`,
 * `video_ddmtv02`, or anything else) to the right frontend component
 * without leaking source_type checks into the UI.
 *
 * - `audio` → tool-ui `<Audio>` with `source_url` as the `src`.
 * - `video_ddmtv01` / `video_ddmtv02` → our `<YouTubeEmbed>`.
 * - anything else → a plain link-style fallback so a stray corpus
 *   (e.g. a future `video_ddmmedia1321` leak) degrades gracefully
 *   rather than crashing.
 */
export type MediaCard =
  | {
      kind: "audio";
      chunkId: string;
      /** Playback URL — prefers `playback_url` (with a `#t=<start_s>`
       * fragment pointing at the cited chunk) over bare `source_url`. */
      src: string;
      title: string;
      sourceUrl: string;
      /** Chunk text (e.g. transcript excerpt) rendered beneath the audio
       * player on welcome cards. */
      description: string;
      /** Full-record duration in milliseconds. Undefined when the corpus
       * doesn't carry a `duration_s` field. */
      durationMs?: number;
    }
  | {
      kind: "youtube";
      chunkId: string;
      url: string;
      title: string;
      sourceUrl: string;
    }
  | { kind: "text"; chunkId: string; title: string; href: string | null };

const YOUTUBE_SOURCE_TYPES = new Set(["video_ddmtv01", "video_ddmtv02"]);

export function toMediaCard(record: EventRecord): MediaCard {
  const sourceType = record.metadata.source_type ?? "";

  if (sourceType === "audio" && record.source_url) {
    // Prefer the human-readable `unit_name` (e.g. "禪與人生") over the
    // raw `title`, which for the audio corpus is the filename (e.g.
    // "s05-u03-02"). `series_name` prefixes it when present so users
    // can see both levels of context at a glance.
    const unit = record.metadata.unit_name;
    const series = record.metadata.series_name;
    const displayTitle = unit
      ? series
        ? `${series} · ${unit}`
        : unit
      : record.title || "(未命名)";
    const durationMs =
      typeof record.metadata.duration_s === "number"
        ? Math.round(record.metadata.duration_s * 1000)
        : undefined;
    return {
      kind: "audio",
      chunkId: record.chunk_id,
      src: record.metadata.playback_url || record.source_url,
      title: displayTitle,
      sourceUrl: record.source_url,
      description: (record.text ?? "").trim(),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  }

  const title = record.title || "(未命名)";

  if (YOUTUBE_SOURCE_TYPES.has(sourceType) && record.source_url) {
    return {
      kind: "youtube",
      chunkId: record.chunk_id,
      url: record.source_url,
      title,
      sourceUrl: record.source_url,
    };
  }

  return {
    kind: "text",
    chunkId: record.chunk_id,
    title,
    href: record.source_url,
  };
}
