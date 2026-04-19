"use client";

import { type FC, useEffect } from "react";

import { PreferencesPanel } from "@/components/tool-ui/preferences-panel";
import type { SourceRecord } from "@/lib/sources";

/**
 * Quiz settings chosen via the preferences-panel dialog. v1 of feature 3:
 * these settings augment the stop-gap chat-prompt quiz dispatch. Phase
 * 2 (features_v2.md item 3) will route them into a backend quiz
 * generator + question-flow UI; the shape stays stable across the cut.
 */
export type QuizPrefs = {
  includeEssay: boolean;
  difficulty: "easy" | "medium" | "hard";
  refresh: "hour" | "day" | "week";
};

export const QUIZ_DEFAULTS: QuizPrefs = {
  includeEssay: false,
  difficulty: "medium",
  refresh: "day",
};

type QuizModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (prefs: QuizPrefs) => void;
};

export const QuizPreferencesModal: FC<QuizModalProps> = ({
  open,
  onClose,
  onConfirm,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // z-[60] sits above the Deep Dive overlay (z-50). The backdrop is
    // a <button> so keyboard + screen-reader users can dismiss without
    // relying on Escape; stopPropagation on the panel wrapper keeps
    // in-panel clicks from bubbling up and triggering it.
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        onClick={onClose}
        aria-label="Close quiz preferences"
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        className="relative w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quiz preferences"
      >
        <PreferencesPanel
          id="quiz-preferences"
          title="小測驗設定"
          sections={[
            {
              heading: "題目設定",
              items: [
                {
                  id: "includeEssay",
                  label: "包含申論題",
                  description: "加入一題開放式申論,觀察你的整體理解。",
                  type: "switch",
                  defaultChecked: QUIZ_DEFAULTS.includeEssay,
                },
                {
                  id: "difficulty",
                  label: "題目難度",
                  description: "控制題目的挑戰程度。",
                  type: "toggle",
                  options: [
                    { value: "easy", label: "簡單" },
                    { value: "medium", label: "中等" },
                    { value: "hard", label: "困難" },
                  ],
                  defaultValue: QUIZ_DEFAULTS.difficulty,
                },
                {
                  id: "refresh",
                  label: "題目更新頻率",
                  description:
                    "本輪未啟用快取,此設定將在後端出題上線後用於快取效期。",
                  type: "toggle",
                  options: [
                    { value: "hour", label: "每小時" },
                    { value: "day", label: "每天" },
                    { value: "week", label: "每週" },
                  ],
                  defaultValue: QUIZ_DEFAULTS.refresh,
                },
              ],
            },
          ]}
          actions={[
            { id: "cancel", label: "取消", variant: "ghost" },
            { id: "save", label: "開始測驗", variant: "default" },
          ]}
          onAction={(actionId, values) => {
            if (actionId === "save") {
              onConfirm({
                includeEssay: Boolean(values.includeEssay),
                difficulty:
                  (values.difficulty as QuizPrefs["difficulty"]) ??
                  QUIZ_DEFAULTS.difficulty,
                refresh:
                  (values.refresh as QuizPrefs["refresh"]) ??
                  QUIZ_DEFAULTS.refresh,
              });
            } else {
              onClose();
            }
          }}
        />
      </div>
    </div>
  );
};

/**
 * Build the zh-TW quiz prompt that the chat flow receives when the
 * user confirms the preferences panel. Stop-gap until the backend
 * quiz endpoint + question-flow UI lands (features_v2.md item 3 phase 2).
 */
export const buildQuizPromptFromPrefs = (
  source: SourceRecord | null,
  prefs: QuizPrefs,
): string => {
  const handle =
    source?.chapter_title || source?.title || source?.book_title || "這份來源";
  const difficultyLabel = {
    easy: "簡單",
    medium: "中等",
    hard: "困難",
  }[prefs.difficulty];
  const essayClause = prefs.includeEssay
    ? "請至少包含一題申論題(開放式說明),其餘題目可為選擇或簡答。"
    : "題目請以選擇或簡答為主,本次暫不需申論題。";
  return (
    `我想針對「${handle}」做一次${difficultyLabel}難度的小測驗。` +
    `請出三到五題,每次先只給一題,等我作答後再判斷對錯並解釋,接著再出下一題。` +
    essayClause +
    `題目涵蓋事實、理解與應用三種層次為佳。`
  );
};
