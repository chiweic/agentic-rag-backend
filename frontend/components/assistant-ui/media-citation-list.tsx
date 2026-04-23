"use client";

import { AudioLinesIcon, ExternalLinkIcon } from "lucide-react";
import type { FC } from "react";
import { YouTubeEmbed } from "@/components/assistant-ui/youtube-embed";
import { Audio } from "@/components/tool-ui/audio";
import type { DeepDiveableCitation } from "@/lib/citations-adapter";

/**
 * In-chat A/V citation renderer for the 聖嚴師父身影 tab. Replaces
 * the text-centric `<CitationList variant="stacked">` the main chat
 * and /events use when the cited chunk originated from an audio or
 * video corpus.
 *
 * Accepts `DeepDiveableCitation[]` (same shape the existing path
 * consumes from `toToolUiCitations`) and routes each entry to:
 *   - `<Audio>` for `sourceType === "audio"`
 *   - `<YouTubeEmbed>` for `video_ddmtv01` / `video_ddmtv02`
 *   - an external-link card for anything else (graceful degradation)
 *
 * Deep Dive is intentionally not offered here — this tab follows the
 * same "scope out Deep Dive" decision as /events — but each card
 * keeps a visible "打開原始出處" affordance so users can still jump
 * out to the DDM page.
 */
type Props = {
  id: string;
  citations: DeepDiveableCitation[];
};

const YOUTUBE_SOURCE_TYPES = new Set(["video_ddmtv01", "video_ddmtv02"]);

export const MediaCitationList: FC<Props> = ({ id, citations }) => {
  if (citations.length === 0) return null;
  return (
    <div
      data-tool-ui-id={id}
      data-slot="media-citation-list"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-5"
    >
      {citations.map((c) => (
        <MediaCitationCard key={c.id} citation={c} />
      ))}
    </div>
  );
};

const MediaCitationCard: FC<{ citation: DeepDiveableCitation }> = ({
  citation,
}) => {
  const { id, href, title, sourceType } = citation;

  if (sourceType === "audio") {
    // Wrap in the same card shell video uses — aspect-video media
    // area on top (audio has no artwork, so we use a muted gradient
    // with a waveform icon so audio + video rows share one visual
    // rhythm) followed by title + compact controls + source link.
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/90 p-2 shadow-sm">
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-muted/40 to-muted/80">
          <AudioLinesIcon className="size-8 text-muted-foreground/60" />
        </div>
        <div className="line-clamp-2 px-1 text-foreground text-sm font-medium leading-snug">
          {title}
        </div>
        {/* min-w-72 max-w-md on the compact variant overflows narrow
            grid cells — override with min-w-0 so the player tracks
            the cell width (audio/audio.tsx:283 in the installed
            shadcn copy). */}
        <Audio
          id={`sy-cite-${id}`}
          assetId={id}
          src={href}
          variant="compact"
          className="min-w-0 max-w-full"
        />
        <OpenSourceLink href={href} />
      </div>
    );
  }

  if (sourceType && YOUTUBE_SOURCE_TYPES.has(sourceType)) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/90 p-2 shadow-sm">
        <YouTubeEmbed url={href} title={title} />
        <div className="line-clamp-2 px-1 text-foreground text-sm font-medium leading-snug">
          {title}
        </div>
        <OpenSourceLink href={href} />
      </div>
    );
  }

  // Unexpected source type — degrade to a plain outbound link so a
  // stray corpus (e.g. a future unlisted video source) doesn't crash
  // the chat render.
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/90 px-4 py-3 text-sm shadow-sm hover:border-foreground/20 hover:bg-muted/40"
    >
      <span className="truncate font-medium text-foreground">{title}</span>
      <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
};

const OpenSourceLink: FC<{ href: string }> = ({ href }) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    className="inline-flex w-fit items-center gap-1 self-start rounded-full px-2 py-1 text-muted-foreground text-xs hover:text-foreground"
  >
    <ExternalLinkIcon className="size-3" />
    打開原始出處
  </a>
);
