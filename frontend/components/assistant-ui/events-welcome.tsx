"use client";

import { useAui } from "@assistant-ui/store";
import { CalendarIcon, SparklesIcon } from "lucide-react";
import { createContext, type FC, useContext, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  type EventRecord,
  fetchRecommendations,
  type RecommendationStatus,
} from "@/lib/recommendations";
import { cn } from "@/lib/utils";

/**
 * Set inside `/events` so the generic `ThreadWelcome` knows to swap
 * the global starter-suggestion strip for the event-recommendation
 * cards below. Any non-events thread leaves this `false` and gets
 * the default welcome.
 */
export const EventsScopeContext = createContext<boolean>(false);

export const useIsEventsScope = (): boolean => useContext(EventsScopeContext);

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      events: EventRecord[];
      profile: string;
      backend: RecommendationStatus;
    };

/**
 * Empty-state content for the events Thread: shows the current user's
 * personalised event recommendations as clickable cards. Clicking a
 * card appends a pre-built prompt to the composer's thread so the
 * user gets an LLM answer grounded in the events corpus.
 *
 * Mirrors the intent of `StarterSuggestions` in the main chat —
 * "here's something you can ask" — but the prompts are hydrated
 * from the backend rather than a stored pool.
 */
export const EventsWelcome: FC = () => {
  const aui = useAui();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchRecommendations()
      .then((response) => {
        if (cancelled) return;
        setState({
          status: "ready",
          events: response.events,
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
  const { events, profile, backend } = state;
  if (backend === "no_activity") {
    return (
      <EmptyCopy
        title="尚未有足夠提問可以推薦"
        body="先在「對話」提問幾次,我們會根據您的興趣推薦相關活動。現在也可以直接在下方提問。"
      />
    );
  }
  if (events.length === 0) {
    return (
      <>
        {profile ? <Profile profile={profile} /> : null}
        <EmptyCopy
          title="目前沒有符合的活動"
          body="沒有找到與您關注主題相符的近期活動。您仍可直接在下方提問。"
        />
      </>
    );
  }

  return (
    <div className="w-full px-4">
      {profile ? <Profile profile={profile} /> : null}
      <div className="mt-3 grid gap-2 pb-4 @md:grid-cols-2">
        {events.map((event) => (
          <EventStarterCard
            key={event.chunk_id}
            event={event}
            onSelect={send}
          />
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

const EventStarterCard: FC<{
  event: EventRecord;
  onSelect: (text: string) => void;
}> = ({ event, onSelect }) => {
  const date = formatDate(event.metadata.publish_date);
  const prompt = `請告訴我更多關於「${event.title}」的活動資訊。`;
  return (
    <Button
      variant="ghost"
      type="button"
      onClick={() => onSelect(prompt)}
      className={cn(
        "flex h-auto w-full flex-col items-start gap-1 rounded-2xl border border-border/70 bg-background/90 px-4 py-3 text-left text-sm shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40",
      )}
    >
      <span className="font-medium text-foreground">{event.title}</span>
      {date ? (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
          <CalendarIcon className="size-3" />
          {date}
        </span>
      ) : null}
    </Button>
  );
};

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
    <div className="mt-3 grid gap-2 pb-4 @md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-16 rounded-2xl border border-border/60 bg-card p-3"
        >
          <div className="h-3 w-2/3 rounded-full bg-muted" />
          <div className="mt-2 h-3 w-1/3 rounded-full bg-muted" />
        </div>
      ))}
    </div>
  </div>
);

function formatDate(raw: string | null | undefined): string {
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.replace(/-/g, "/");
  try {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("zh-TW", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  } catch {
    // fall through
  }
  return raw;
}
