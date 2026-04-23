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
      src: string;
      title: string;
      sourceUrl: string;
      /** Chunk text (e.g. transcript excerpt) rendered beneath the audio
       * player on welcome cards. */
      description: string;
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
  const title = record.title || "(未命名)";

  if (sourceType === "audio" && record.source_url) {
    return {
      kind: "audio",
      chunkId: record.chunk_id,
      src: record.source_url,
      title,
      sourceUrl: record.source_url,
      description: (record.text ?? "").trim(),
    };
  }

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
