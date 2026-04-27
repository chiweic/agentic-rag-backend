"use client";

import { useAui } from "@assistant-ui/store";
import { SparklesIcon } from "lucide-react";
import { createContext, type FC, useContext, useEffect, useState } from "react";
import { YouTubeEmbed } from "@/components/assistant-ui/youtube-embed";
import { Audio } from "@/components/tool-ui/audio";
import { Button } from "@/components/ui/button";
import { type MediaCard, toMediaCard } from "@/lib/mediaAdapter";
import {
  fetchRecommendations,
  type RecommendationStatus,
} from "@/lib/recommendations";

/**
 * Set inside `/sheng-yen` so the generic `ThreadWelcome` swaps its
 * default starter-suggestion strip for the ShengYenWelcome component.
 * Any non-sheng-yen thread leaves this `false`.
 */
export const ShengYenScopeContext = createContext<boolean>(false);

export const useIsShengYenScope = (): boolean =>
  useContext(ShengYenScopeContext);

/** rag_bot corpora this tab pulls from. */
const SHENG_YEN_SOURCES = ["audio", "video_ddmtv01", "video_ddmtv02"] as const;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      cards: MediaCard[];
      profile: string;
      backend: RecommendationStatus;
    };

/**
 * Empty-state content for the 聖嚴師父身影 Thread: interest-profile
 * banner + a mixed grid of playable Audio cards and lazy YouTube
 * cards. Clicking a card seeds a prompt (mode-specific wording) into
 * the composer and sends it.
 *
 * Mirrors events-welcome.tsx but hydrates from the recommendations
 * endpoint with `sources=audio,video_ddmtv01,video_ddmtv02`, which
 * (after the backend's round-robin merge) alternates modalities in
 * the returned grid.
 */
export const ShengYenWelcome: FC = () => {
  const aui = useAui();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchRecommendations({ sources: SHENG_YEN_SOURCES, limit: 6 })
      .then((response) => {
        if (cancelled) return;
        setState({
          status: "ready",
          cards: response.events.map(toMediaCard),
          profile: response.profile,
          backend: response.status,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "載入失敗",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const send = (text: string) => {
    if (aui.thread().getState().isRunning) return;
    const composer = aui.composer();
    aui.thread().append({
      content: [{ type: "text", text }],
      runConfig: composer.getState().runConfig,
    });
  };

  if (state.status === "loading") return <Skeleton />;
  if (state.status === "error") {
    return (
      <EmptyCopy
        title="暫時無法載入推薦"
        body={`${state.message}。您仍可直接提問。`}
      />
    );
  }

  const { cards, profile, backend } = state;
  if (backend === "no_activity") {
    return (
      <EmptyCopy
        title="尚未有足夠提問可以推薦"
        body="先在「對話」提問幾次,我們會根據您的興趣推薦相關影音。現在也可以直接在下方提問。"
      />
    );
  }
  if (cards.length === 0) {
    return (
      <>
        {profile ? <Profile profile={profile} /> : null}
        <EmptyCopy
          title="目前沒有符合的影音"
          body="找不到與您關注主題相符的影音內容。您仍可直接在下方提問。"
        />
      </>
    );
  }

  return (
    <div className="w-full px-4">
      {profile ? <Profile profile={profile} /> : null}
      <div className="mt-3 grid gap-3 pb-4 @md:grid-cols-2">
        {cards.map((card) => (
          <MediaStarterCard key={card.chunkId} card={card} onSelect={send} />
        ))}
      </div>
    </div>
  );
};

const Profile: FC<{ profile: string }> = ({ profile }) => (
  <div className="flex items-start gap-2 rounded-2xl border border-border/70 bg-muted/25 px-4 py-3 text-muted-foreground text-sm">
    <SparklesIcon className="mt-0.5 size-4 shrink-0" />
    <p>
      <span className="font-medium text-foreground">從您最近的提問看來:</span>{" "}
      {profile}
    </p>
  </div>
);

const MediaStarterCard: FC<{
  card: MediaCard;
  onSelect: (text: string) => void;
}> = ({ card, onSelect }) => {
  const prompt = buildStarterPrompt(card);

  // Audio + YouTube render as playable cards with a title and a
  // "詢問更多" action underneath — the card itself stays interactive
  // (playback controls) so we don't swallow the media interaction by
  // making the whole container a button.
  if (card.kind === "audio") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/90 p-3 shadow-sm">
        <Audio
          id={`sy-starter-${card.chunkId}`}
          assetId={card.chunkId}
          src={card.src}
          title={card.title}
          {...(card.durationMs !== undefined
            ? { durationMs: card.durationMs }
            : {})}
          variant="compact"
        />
        {card.description ? (
          <p className="line-clamp-3 text-pretty px-1 text-muted-foreground text-sm leading-relaxed">
            {card.description}
          </p>
        ) : null}
        <AskButton onClick={() => onSelect(prompt)} />
      </div>
    );
  }

  if (card.kind === "youtube") {
    return (
      <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/90 p-3 shadow-sm">
        <YouTubeEmbed url={card.url} title={card.title} />
        <div className="px-1 text-foreground text-sm font-medium">
          {card.title}
        </div>
        <AskButton onClick={() => onSelect(prompt)} />
      </div>
    );
  }

  // Text fallback: plain clickable card (title → send prompt).
  return (
    <Button
      variant="ghost"
      type="button"
      onClick={() => onSelect(prompt)}
      className="flex h-auto w-full flex-col items-start gap-1 rounded-2xl border border-border/70 bg-background/90 px-4 py-3 text-left text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40"
    >
      <span className="font-medium text-foreground">{card.title}</span>
    </Button>
  );
};

const AskButton: FC<{ onClick: () => void }> = ({ onClick }) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={onClick}
    className="h-auto self-start rounded-full border border-border/70 px-3 py-1 text-muted-foreground text-xs hover:text-foreground"
  >
    詢問更多
  </Button>
);

function buildStarterPrompt(card: MediaCard): string {
  const modality = card.kind === "audio" ? "音檔" : "影片";
  return `告訴我更多關於「${card.title}」這段${modality}的內容。`;
}

const EmptyCopy: FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="w-full px-4 pb-4">
    <div className="rounded-2xl border border-border/70 bg-muted/20 px-6 py-8 text-center">
      <h2 className="font-medium text-foreground">{title}</h2>
      <p className="mt-2 text-muted-foreground text-sm">{body}</p>
    </div>
  </div>
);

const Skeleton: FC = () => (
  <div className="w-full px-4">
    <div className="h-12 rounded-2xl bg-muted/40" />
    <div className="mt-3 grid gap-3 pb-4 @md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-card p-3"
        >
          <div className="aspect-video w-full rounded-lg bg-muted" />
          <div className="h-3 w-2/3 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  </div>
);
