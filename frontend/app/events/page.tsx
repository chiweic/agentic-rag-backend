"use client";

import { CalendarIcon, ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import {
  type EventRecord,
  fetchRecommendations,
  type RecommendationResponse,
} from "@/lib/recommendations";

/**
 * `/events` — event recommendations tab (features_v2.md §4a).
 *
 * Fetches the backend's interest profile + scored event hits for the
 * current user and renders them as a card grid. Every non-error
 * status ({no_activity, summary_failed, no_matches}) gets a
 * dedicated empty-state copy so the user knows *why* the grid is
 * empty — hiding that distinction made "the feature is broken"
 * indistinguishable from "come back later."
 */

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; response: RecommendationResponse };

export default function EventsPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchRecommendations()
      .then((response) => {
        if (!cancelled) setState({ status: "ready", response });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "載入失敗",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto h-full w-full max-w-4xl overflow-y-auto px-6 py-8">
      <header className="mb-6">
        <h1 className="font-semibold text-2xl">活動推薦</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          根據您最近的提問,為您推薦法鼓山近期的活動。
        </p>
      </header>
      <Content state={state} />
    </main>
  );
}

const Content: FC<{ state: State }> = ({ state }) => {
  if (state.status === "loading") {
    return <LoadingSkeleton />;
  }
  if (state.status === "error") {
    return (
      <EmptyState
        title="暫時無法載入推薦"
        body={`${state.message}。請稍後再試。`}
      />
    );
  }
  const { response } = state;
  if (response.status === "no_activity") {
    return (
      <EmptyState
        title="尚未有足夠提問"
        body="在對話中提問幾次後再回來,我們會根據您的提問推薦活動。"
      />
    );
  }
  if (response.status === "summary_failed") {
    return (
      <EmptyState
        title="暫時無法產生推薦"
        body="摘要服務目前無法使用,請稍後再試。"
      />
    );
  }
  if (response.status === "no_matches") {
    return (
      <>
        {response.profile ? <ProfileBanner profile={response.profile} /> : null}
        <EmptyState
          title="目前沒有符合的活動"
          body="找不到與您關注主題相符的近期活動。歡迎瀏覽「法鼓山活動」網站。"
        />
      </>
    );
  }

  return (
    <>
      <ProfileBanner profile={response.profile} />
      <div className="mt-6 grid gap-3 @md:grid-cols-2">
        {response.events.map((event) => (
          <EventCard key={event.chunk_id} event={event} />
        ))}
      </div>
    </>
  );
};

const ProfileBanner: FC<{ profile: string }> = ({ profile }) => (
  <div className="flex items-start gap-2 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3 text-muted-foreground text-sm">
    <SparklesIcon className="mt-0.5 size-4 shrink-0" />
    <p>
      <span className="font-medium text-foreground">從您最近的提問看來:</span>{" "}
      {profile}
    </p>
  </div>
);

const EventCard: FC<{ event: EventRecord }> = ({ event }) => {
  const date = formatDate(event.metadata.publish_date);
  const snippet = truncate(event.text, 140);
  const href = event.source_url ?? undefined;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-base leading-snug">{event.title}</h3>
        {href ? (
          <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </div>
      {date ? (
        <div className="mt-1 flex items-center gap-1.5 text-muted-foreground text-xs">
          <CalendarIcon className="size-3" />
          <time dateTime={event.metadata.publish_date ?? undefined}>
            {date}
          </time>
        </div>
      ) : null}
      {snippet ? (
        <p className="mt-3 text-pretty text-muted-foreground text-sm leading-relaxed">
          {snippet}
        </p>
      ) : null}
    </>
  );

  const cardClass =
    "group flex h-full flex-col rounded-2xl border border-border/70 bg-card p-4 text-sm shadow-xs transition-colors hover:border-foreground/20";

  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`${cardClass} focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`}
    >
      {content}
    </a>
  ) : (
    <div className={cardClass}>{content}</div>
  );
};

const EmptyState: FC<{ title: string; body: string }> = ({ title, body }) => (
  <div className="rounded-2xl border border-border/70 bg-muted/20 px-6 py-10 text-center">
    <h2 className="font-medium text-foreground">{title}</h2>
    <p className="mt-2 text-muted-foreground text-sm">{body}</p>
  </div>
);

const LoadingSkeleton: FC = () => (
  <div className="space-y-3">
    <div className="h-12 rounded-2xl bg-muted/40" />
    <div className="grid gap-3 @md:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-32 rounded-2xl border border-border/60 bg-card p-4"
        >
          <div className="h-4 w-2/3 rounded-full bg-muted" />
          <div className="mt-3 h-3 w-1/3 rounded-full bg-muted" />
          <div className="mt-4 space-y-2">
            <div className="h-3 w-full rounded-full bg-muted" />
            <div className="h-3 w-4/5 rounded-full bg-muted" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

function truncate(text: string, max: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return "";
  // Backend emits YYYY-MM-DD for the events corpus. Keep the raw
  // form if it's already readable; otherwise fall back to locale
  // formatting.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw.replace(/-/g, "/");
  }
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
