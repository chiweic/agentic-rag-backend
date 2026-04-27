"use client";

import { PlayIcon } from "lucide-react";
import { type FC, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Lazy YouTube embed. Renders a thumbnail + play overlay by default
 * and only swaps in an iframe when the user clicks play — keeps the
 * grid cheap when many cards render at once.
 *
 * Exists because tool-ui's `<Video>` component uses a native
 * `<video>` tag which can't play YouTube watch URLs. Our rag_bot
 * video corpora (`video_ddmtv01` / `video_ddmtv02`) both carry
 * `https://www.youtube.com/watch?v=…` in `source_url`, so we derive
 * the video id client-side, build the `youtube-nocookie.com` embed
 * URL, and use `img.youtube.com/vi/{id}/hqdefault.jpg` as the poster.
 */
export type YouTubeEmbedProps = {
  url: string;
  title?: string;
  className?: string;
  /** Aspect ratio string for the container. Defaults to 16:9. */
  ratio?: "16:9" | "4:3" | "1:1";
};

export const YouTubeEmbed: FC<YouTubeEmbedProps> = ({
  url,
  title,
  className,
  ratio = "16:9",
}) => {
  const [playing, setPlaying] = useState(false);
  const videoId = extractYouTubeId(url);

  // No parseable id — fall back to a plain link card so we at least
  // render something clickable instead of a broken iframe.
  if (!videoId) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className={cn(
          "group flex aspect-video w-full items-center justify-center rounded-xl border border-border/70 bg-muted/30 text-muted-foreground text-sm",
          "hover:border-foreground/20 hover:bg-muted/50",
          className,
        )}
      >
        {title ?? "開啟影片"} ↗
      </a>
    );
  }

  const poster = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  const embed = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0`;
  const aspect =
    ratio === "4:3"
      ? "aspect-[4/3]"
      : ratio === "1:1"
        ? "aspect-square"
        : "aspect-video";

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-xl bg-black",
        aspect,
        className,
      )}
    >
      {playing ? (
        <iframe
          src={embed}
          title={title ?? "YouTube video"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={title ? `播放: ${title}` : "播放影片"}
          className="group absolute inset-0 cursor-pointer"
        >
          {/** biome-ignore lint/performance/noImgElement: YouTube thumbnails are external, next/image optimization adds no value. */}
          <img
            src={poster}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-105">
              <PlayIcon className="size-6 translate-x-0.5 fill-current" />
            </span>
          </span>
        </button>
      )}
    </div>
  );
};

/**
 * Pull the 11-character YouTube video id out of any URL flavour we
 * reasonably expect (`youtube.com/watch?v=…`, `youtu.be/…`,
 * `youtube.com/embed/…`). Returns `null` on anything else so the
 * caller can fall back.
 */
export function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      // /watch?v=ID
      const v = u.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      // /embed/ID or /shorts/ID
      const match = u.pathname.match(/^\/(?:embed|shorts)\/([\w-]{11})/);
      if (match) return match[1];
    }
  } catch {
    // fall through
  }
  return null;
}
