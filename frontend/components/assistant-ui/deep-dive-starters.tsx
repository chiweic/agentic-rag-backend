"use client";

import { useAui } from "@assistant-ui/store";
import { SearchIcon } from "lucide-react";
import { createContext, type FC, useContext } from "react";

import { Button } from "@/components/ui/button";
import type { SourceRecord } from "@/lib/sources";

/**
 * Populated inside the Deep Dive overlay with the fetched source record
 * so nested components (specifically the deep-dive Thread's welcome and
 * per-turn follow-up row) can render source-aware starter prompts.
 * `null` means "not in a deep dive" or "source still loading".
 *
 * Lives in this file (rather than `deep-dive-overlay.tsx`) to break a
 * circular import with `thread.tsx`: the overlay imports `Thread` from
 * thread.tsx, and `thread.tsx` needs these bits for its welcome and
 * assistant-message footer. Co-locating the context + starters here
 * keeps the overlay free of thread.tsx-adjacent imports.
 */
export const DeepDiveSourceContext = createContext<SourceRecord | null>(null);

export const useDeepDiveSource = (): SourceRecord | null =>
  useContext(DeepDiveSourceContext);

/**
 * Source-aware starter prompts rendered in two places:
 * - Empty Thread welcome (`variant="start"`).
 * - Under the latest assistant turn as a ratchet for further
 *   exploration (`variant="followup"`).
 *
 * Prompts are in Traditional Chinese and reference the record's
 * chapter/title/book so clicking one sends a natural-reading query
 * that the LLM can answer without retyping source context.
 */
export const DeepDiveStarters: FC<{ variant?: "start" | "followup" }> = ({
  variant = "start",
}) => {
  const source = useDeepDiveSource();
  const aui = useAui();

  const prompts = buildDeepDivePrompts(source);
  const heading = variant === "start" ? "從這些問題開始:" : "繼續探索:";

  return (
    <div className="w-full">
      <div className="mb-3 px-1 text-muted-foreground text-sm">{heading}</div>
      <div className="grid w-full gap-2 pb-4 @md:grid-cols-2">
        {prompts.map((prompt) => (
          <Button
            key={prompt.id}
            variant="ghost"
            type="button"
            className="h-auto w-full flex-col items-start gap-1 rounded-3xl border border-border/70 bg-background/90 px-4 py-4 text-left text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40"
            onClick={() => {
              if (aui.thread().getState().isRunning) return;
              const composer = aui.composer();
              aui.thread().append({
                content: [{ type: "text", text: prompt.text }],
                runConfig: composer.getState().runConfig,
              });
            }}
          >
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <SearchIcon className="size-3" />
              {prompt.label}
            </span>
            <span className="text-pretty font-medium text-foreground leading-6">
              {prompt.text}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
};

type DeepDivePrompt = { id: string; label: string; text: string };

const buildDeepDivePrompts = (
  source: SourceRecord | null,
): DeepDivePrompt[] => {
  const handle =
    source?.chapter_title || source?.title || source?.book_title || "這份來源";
  return [
    {
      id: "summarize",
      label: "總結",
      text: `請總結「${handle}」的內容。`,
    },
    {
      id: "main-points",
      label: "重點",
      text: `「${handle}」的主要重點是什麼?`,
    },
    {
      id: "critical",
      label: "關鍵句子",
      text: `請列出「${handle}」中最重要的句子。`,
    },
    {
      id: "explain",
      label: "深入淺出",
      text: `請以更淺顯的方式解釋「${handle}」的核心概念。`,
    },
  ];
};
