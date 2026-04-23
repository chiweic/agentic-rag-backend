"use client";

import {
  AudioLinesIcon,
  ExternalLinkIcon,
  PauseIcon,
  PlayIcon,
} from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";
import { YouTubeEmbed } from "@/components/assistant-ui/youtube-embed";
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
    // Match video's card shape: aspect-video placeholder (click =
    // play/pause) + title + source link. Keeps audio and video cards
    // at the same height in a 5-col grid — the previous layout had an
    // extra <Audio> player row that made audio cards noticeably
    // taller than video cards.
    return <AudioCitationCard id={id} href={href} title={title} />;
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

const AudioCitationCard: FC<{ id: string; href: string; title: string }> = ({
  id,
  href,
  title,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPauseOrEnd = () => setPlaying(false);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPauseOrEnd);
    el.addEventListener("ended", onPauseOrEnd);
    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPauseOrEnd);
      el.removeEventListener("ended", onPauseOrEnd);
    };
  }, []);

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/90 p-2 shadow-sm">
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `暫停: ${title}` : `播放: ${title}`}
        className="group relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-muted/40 to-muted/80 transition-colors hover:from-muted/50 hover:to-muted/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <AudioLinesIcon className="size-8 text-muted-foreground/60 transition-opacity group-hover:opacity-80" />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-105">
            {playing ? (
              <PauseIcon className="size-4 fill-current" />
            ) : (
              <PlayIcon className="size-4 translate-x-0.5 fill-current" />
            )}
          </span>
        </span>
      </button>
      {/* biome-ignore lint/a11y/useMediaCaption: transcripts are ingested as chunk text (used in the reply + welcome description); no captions track exists for rag_bot audio records. */}
      <audio ref={audioRef} src={href} preload="none" data-cite-id={id} />
      <div className="line-clamp-2 px-1 text-foreground text-sm font-medium leading-snug">
        {title}
      </div>
      <OpenSourceLink href={href} />
    </div>
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
