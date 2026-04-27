"use client";

import { useAui } from "@assistant-ui/store";
import {
  GraduationCapIcon,
  LightbulbIcon,
  ListIcon,
  type LucideIcon,
  QuoteIcon,
  StarIcon,
} from "lucide-react";
import { createContext, type FC, useContext, useState } from "react";

import { QuizDialog } from "@/components/assistant-ui/quiz-dialog";
import { Button } from "@/components/ui/button";
import { buildQuizGradingPrompt, type Quiz } from "@/lib/quiz";
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
  const [quizOpen, setQuizOpen] = useState(false);

  const prompts = buildDeepDivePrompts(source);
  const exploreHeading = variant === "start" ? "從這些問題開始:" : "繼續探索:";
  const quizReady = source !== null;
  const sourceLabel =
    source?.chapter_title || source?.title || source?.book_title || undefined;

  const send = (text: string) => {
    if (aui.thread().getState().isRunning) return;
    const composer = aui.composer();
    aui.thread().append({
      content: [{ type: "text", text }],
      runConfig: composer.getState().runConfig,
    });
  };

  const handleQuizComplete = (
    quiz: Quiz,
    answers: Record<string, string[]>,
  ) => {
    setQuizOpen(false);
    send(buildQuizGradingPrompt(quiz, answers));
  };

  return (
    <div className={variant === "start" ? "w-full px-4" : "w-full"}>
      {/* Section 1: open-ended exploration of the pinned source. */}
      <div className="mb-3 text-muted-foreground text-sm">{exploreHeading}</div>
      <div className="flex w-full flex-wrap gap-2 pb-4">
        {prompts.map((prompt) => {
          const Icon = prompt.icon;
          return (
            <Button
              key={prompt.id}
              variant="ghost"
              type="button"
              className="h-auto w-auto gap-2 rounded-2xl border border-border/70 bg-background/90 px-3 py-1.5 text-sm font-medium shadow-sm transition-all hover:border-foreground/20 hover:bg-muted/40"
              onClick={() => send(prompt.text)}
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span>{prompt.label}</span>
            </Button>
          );
        })}
        {/* Self-test opens a QuizDialog that fetches an MCQ from the
            backend and renders it via @tool-ui/question-flow. Answers
            come back through the component's onComplete — never the
            composer — and we dispatch a grading turn into this same
            thread. Disabled until the overlay's source fetch resolves
            so we always have a record_id to query. */}
        <Button
          type="button"
          variant="ghost"
          disabled={!quizReady}
          className="h-auto w-auto gap-2 rounded-2xl border border-border/70 bg-background/90 px-3 py-1.5 text-sm font-medium shadow-sm transition-all hover:border-foreground/20 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => setQuizOpen(true)}
        >
          <GraduationCapIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span>小測驗</span>
        </Button>
      </div>
      {source ? (
        <QuizDialog
          open={quizOpen}
          onOpenChange={setQuizOpen}
          sourceType={source.source_type}
          recordId={source.record_id}
          sourceLabel={sourceLabel}
          onComplete={handleQuizComplete}
        />
      ) : null}
    </div>
  );
};

type DeepDivePrompt = {
  id: string;
  label: string;
  text: string;
  icon: LucideIcon;
};

// Icons chosen so each action is identifiable at a glance without
// reading the label — helpful since the cards are now label-only.
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
      icon: ListIcon,
    },
    {
      id: "main-points",
      label: "重點",
      text: `「${handle}」的主要重點是什麼?`,
      icon: StarIcon,
    },
    {
      id: "critical",
      label: "關鍵句子",
      text: `請列出「${handle}」中最重要的句子。`,
      icon: QuoteIcon,
    },
    {
      id: "explain",
      label: "深入淺出",
      text: `請以更淺顯的方式解釋「${handle}」的核心概念。`,
      icon: LightbulbIcon,
    },
  ];
};
