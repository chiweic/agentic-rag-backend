"use client";

import { useAui } from "@assistant-ui/store";
import { ExternalLinkIcon, NewspaperIcon, SparklesIcon } from "lucide-react";
import { createContext, type FC, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  fetchWhatsNewSuggestions,
  type WhatsNewStatus,
  type WhatsNewSuggestion,
} from "@/lib/whatsNew";

/**
 * Set inside `/whats-new` so the generic `ThreadWelcome` swaps its
 * default starter-suggestion strip for the news + dharma-action
 * cards below. Any non-whats-new thread leaves this `false`.
 */
export const WhatsNewScopeContext = createContext<boolean>(false);

export const useIsWhatsNewScope = (): boolean =>
  useContext(WhatsNewScopeContext);

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      suggestions: WhatsNewSuggestion[];
      profile: string;
      backend: WhatsNewStatus;
    };

/**
 * Empty-state content for the 新鮮事 Thread: news-driven recommendation
 * cards. Each card shows a headline + an LLM-generated dharma action
 * question; clicking fires the concatenated prompt as a chat turn.
 *
 * Mirrors events-welcome.tsx / sheng-yen-welcome.tsx structurally but
 * hydrates from /whats-new-suggestions (not /recommendations) because
 * the data shape is different (headline + action pair, not retrieval
 * hit). The card click path matches the other tabs — thread.append
 * with the composer's runConfig so scope metadata survives the send.
 */
export const WhatsNewWelcome: FC = () => {
  const aui = useAui();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchWhatsNewSuggestions(6)
      .then((response) => {
        if (cancelled) return;
        setState({
          status: "ready",
          suggestions: response.suggestions,
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
        title="暫時無法載入今日主題"
        body={`${state.message}。您仍可直接提問。`}
      />
    );
  }

  const { suggestions, profile, backend } = state;
  if (backend === "no_feed") {
    return (
      <EmptyCopy
        title="新聞來源尚未設定"
        body="後端目前沒有設定新聞提供者。請先在下方提問,我們仍可在法鼓山法典中為您解答。"
      />
    );
  }
  if (backend === "no_news" || suggestions.length === 0) {
    return (
      <EmptyCopy
        title="目前沒有今日主題"
        body="新聞來源暫時沒有可用的標題。您仍可直接在下方提問。"
      />
    );
  }

  return (
    <div className="w-full px-4">
      {profile ? <Profile profile={profile} /> : null}
      <div className="mt-3 grid gap-3 pb-4 @md:grid-cols-2">
        {suggestions.map((s) => (
          <WhatsNewCard key={s.id} suggestion={s} onSelect={send} />
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

const WhatsNewCard: FC<{
  suggestion: WhatsNewSuggestion;
  onSelect: (text: string) => void;
}> = ({ suggestion, onSelect }) => (
  <Button
    variant="ghost"
    type="button"
    onClick={() => onSelect(suggestion.combined_prompt)}
    className={cn(
      "flex h-auto w-full flex-col items-start gap-2 rounded-2xl border border-border/70 bg-background/90 px-4 py-3 text-left text-sm shadow-sm transition-all",
      "hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40",
    )}
  >
    <div className="flex w-full items-start gap-2">
      <NewspaperIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-pretty font-medium text-foreground leading-snug">
        {suggestion.title}
      </span>
    </div>
    <span className="text-muted-foreground text-xs leading-snug">
      {suggestion.action}
    </span>
    {suggestion.url ? (
      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
        <ExternalLinkIcon className="size-3" />
        {suggestion.source || "新聞來源"}
      </span>
    ) : null}
  </Button>
);

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
          className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-card p-4"
        >
          <div className="h-4 w-3/4 rounded-full bg-muted" />
          <div className="h-3 w-1/2 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  </div>
);
