"use client";

import { useAui } from "@assistant-ui/store";
import { GraduationCapIcon, SearchIcon } from "lucide-react";
import {
  createContext,
  type FC,
  type ReactNode,
  useContext,
  useState,
} from "react";

import {
  buildQuizPromptFromPrefs,
  QuizPreferencesModal,
} from "@/components/assistant-ui/quiz-preferences";
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
  const [quizOpen, setQuizOpen] = useState(false);

  const prompts = buildDeepDivePrompts(source);

  const send = (text: string) => {
    if (aui.thread().getState().isRunning) return;
    const composer = aui.composer();
    aui.thread().append({
      content: [{ type: "text", text }],
      runConfig: composer.getState().runConfig,
    });
  };

  const openQuiz = () => {
    if (aui.thread().getState().isRunning) return;
    setQuizOpen(true);
  };

  // Under-message follow-ups stay visually light — just inline chips
  // with the primary label ("總結", "重點", ...). Full prompt text is
  // shipped on click via `send` but not shown in the chip; keeps the
  // conversation readable while still offering the same actions.
  const modal = (
    <QuizPreferencesModal
      open={quizOpen}
      onClose={() => setQuizOpen(false)}
      onConfirm={(prefs) => {
        setQuizOpen(false);
        send(buildQuizPromptFromPrefs(source, prefs));
      }}
    />
  );

  if (variant === "followup") {
    return (
      <>
        <div className="w-full">
          <div className="mb-2 px-1 text-muted-foreground text-xs uppercase tracking-[0.12em]">
            繼續探索
          </div>
          <div className="flex flex-wrap gap-2">
            {prompts.map((prompt) => (
              <Chip
                key={prompt.id}
                icon={<SearchIcon className="size-3 text-muted-foreground" />}
                label={prompt.label}
                onClick={() => send(prompt.text)}
              />
            ))}
            <Chip
              icon={
                <GraduationCapIcon className="size-3 text-muted-foreground" />
              }
              label="小測驗"
              onClick={openQuiz}
            />
          </div>
        </div>
        {modal}
      </>
    );
  }

  return (
    <>
      <div className="w-full">
        {/* Section 1: open-ended exploration of the pinned source. */}
        <div className="mb-3 px-1 text-muted-foreground text-sm">
          從這些問題開始:
        </div>
        <div className="grid w-full gap-2 pb-4 @md:grid-cols-2">
          {prompts.map((prompt) => (
            <Button
              key={prompt.id}
              variant="ghost"
              type="button"
              className="h-auto w-full flex-col items-start gap-1 rounded-3xl border border-border/70 bg-background/90 px-4 py-4 text-left text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40"
              onClick={() => send(prompt.text)}
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

        {/* Section 2: self-test. Clicking opens the quiz preferences
            modal; on save, the chosen settings build a zh-TW chat prompt
            (stop-gap until features_v2.md item 3 phase 2 wires a backend
            quiz generator + question-flow UI). */}
        <div className="mb-3 px-1 text-muted-foreground text-sm">自我測試:</div>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full flex-col items-start gap-1 rounded-3xl border border-border/70 bg-background/90 px-4 py-4 text-left text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40"
          onClick={openQuiz}
        >
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <GraduationCapIcon className="size-3" />
            小測驗
          </span>
          <span className="text-pretty font-medium text-foreground leading-6">
            對內容有一定理解，開始自我測試
          </span>
        </Button>
      </div>
      {modal}
    </>
  );
};

const Chip: FC<{
  icon: ReactNode;
  label: string;
  onClick: () => void;
}> = ({ icon, label, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-3 py-1.5 text-foreground text-xs font-medium shadow-sm transition-all hover:-translate-y-px hover:border-foreground/20 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {icon}
      {label}
    </button>
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
