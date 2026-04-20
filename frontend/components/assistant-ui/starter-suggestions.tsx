"use client";

import { useAui } from "@assistant-ui/store";
import { SparklesIcon } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StarterSuggestion = {
  id: string;
  text: string;
};

type StarterSuggestionsResponse = {
  suggestions: StarterSuggestion[];
};

type StarterSuggestionsState = {
  status: "idle" | "loading" | "ready" | "warming_up" | "fallback";
  suggestions: StarterSuggestion[];
};

const FALLBACK_SUGGESTIONS: StarterSuggestion[] = [
  { id: "fallback-1", text: "請給我今日主題的深度概覽。" },
  { id: "fallback-2", text: "推薦我一個值得探索的主題。" },
  { id: "fallback-3", text: "建議我從哪個問題開始。" },
  { id: "fallback-4", text: "從知識庫中給我一個有依據的範例。" },
];

// Retry while the backend pool is still warming up on first boot. Backend
// returns 503 {status:"warming_up"} until the async pool builder finishes,
// typically within a few seconds. Without retry the user would see the
// skeleton and need to refresh manually.
const MAX_WARMING_RETRIES = 5;
const WARMING_RETRY_DELAY_MS = 2000;

let cachedStarterSuggestions: StarterSuggestionsState | null = null;

const fetchStarterSuggestionsOnce =
  async (): Promise<StarterSuggestionsState> => {
    try {
      const res = await fetch("/api/suggestions/starter?n=4");
      if (res.status === 503) {
        return { status: "warming_up", suggestions: [] };
      }

      if (!res.ok) {
        return { status: "fallback", suggestions: FALLBACK_SUGGESTIONS };
      }

      const data = (await res.json()) as StarterSuggestionsResponse;
      return {
        status: "ready",
        suggestions:
          data.suggestions?.length > 0
            ? data.suggestions
            : FALLBACK_SUGGESTIONS,
      };
    } catch {
      return { status: "fallback", suggestions: FALLBACK_SUGGESTIONS };
    }
  };

const useStarterSuggestions = () => {
  const [state, setState] = useState<StarterSuggestionsState>(
    cachedStarterSuggestions ?? { status: "loading", suggestions: [] },
  );

  useEffect(() => {
    let cancelled = false;

    if (cachedStarterSuggestions) {
      setState(cachedStarterSuggestions);
      return () => {
        cancelled = true;
      };
    }

    const run = async () => {
      setState({ status: "loading", suggestions: [] });

      for (let attempt = 0; attempt < MAX_WARMING_RETRIES; attempt++) {
        if (cancelled) return;
        const result = await fetchStarterSuggestionsOnce();
        if (cancelled) return;

        if (result.status !== "warming_up") {
          cachedStarterSuggestions = result;
          setState(result);
          return;
        }

        // Still warming — show the warming-up skeleton state while we wait.
        setState(result);
        if (attempt < MAX_WARMING_RETRIES - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, WARMING_RETRY_DELAY_MS),
          );
        }
      }

      // Gave up — show fallback prompts rather than hang on the skeleton.
      const fallbackState: StarterSuggestionsState = {
        status: "fallback",
        suggestions: FALLBACK_SUGGESTIONS,
      };
      cachedStarterSuggestions = fallbackState;
      if (!cancelled) setState(fallbackState);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};

const StarterSuggestionButton: FC<{ suggestion: StarterSuggestion }> = ({
  suggestion,
}) => {
  const aui = useAui();

  return (
    <Button
      variant="ghost"
      className="h-auto w-full flex-col items-start rounded-3xl border border-border/70 bg-background/90 px-4 py-4 text-left text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40"
      onClick={() => {
        if (aui.thread().getState().isRunning) return;
        const composer = aui.composer();
        aui.thread().append({
          content: [{ type: "text", text: suggestion.text }],
          runConfig: composer.getState().runConfig,
        });
      }}
      type="button"
    >
      <span className="text-pretty font-medium text-foreground leading-6">
        {suggestion.text}
      </span>
    </Button>
  );
};

const SKELETON_PLACEHOLDER_IDS = [
  "starter-skeleton-1",
  "starter-skeleton-2",
  "starter-skeleton-3",
  "starter-skeleton-4",
];

const StarterSuggestionSkeleton: FC = () => {
  return (
    <div className="grid w-full gap-2 pb-4 @md:grid-cols-2">
      {SKELETON_PLACEHOLDER_IDS.map((placeholderId) => (
        <div
          key={placeholderId}
          className="relative overflow-hidden rounded-3xl border border-border/70 bg-background/80 px-4 py-4"
        >
          <div className="space-y-3">
            <div className="h-4 w-11/12 rounded-full bg-muted" />
            <div className="h-4 w-8/12 rounded-full bg-muted" />
          </div>
          <div className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
};

export const StarterSuggestions: FC = () => {
  const { status, suggestions } = useStarterSuggestions();

  if (status === "loading" || status === "warming_up") {
    return (
      <div className="w-full">
        <div className="mb-3 px-1 text-muted-foreground text-sm">
          {status === "warming_up" ? "建議預備中…" : "載入建議中…"}
        </div>
        <StarterSuggestionSkeleton />
      </div>
    );
  }

  if (suggestions.length === 0) return null;

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-2 px-1 text-muted-foreground text-sm">
        <SparklesIcon className="size-4" />
        試試以下問題
      </div>
      <div className={cn("grid w-full gap-2 pb-4", "@md:grid-cols-2")}>
        {suggestions.map((suggestion) => (
          <StarterSuggestionButton
            key={suggestion.id}
            suggestion={suggestion}
          />
        ))}
      </div>
    </div>
  );
};
