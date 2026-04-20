"use client";

import { type FC, useEffect, useState } from "react";

import { QuestionFlow } from "@/components/tool-ui/question-flow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchQuiz, type Quiz } from "@/lib/quiz";

type QuizDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType: string;
  recordId: string;
  sourceLabel?: string;
  onComplete: (quiz: Quiz, answers: Record<string, string[]>) => void;
};

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; quiz: Quiz };

/**
 * Modal that lives on top of the Deep Dive overlay. When opened, it
 * requests a fresh MCQ from `/quiz/generate` scoped to the pinned
 * record and renders it via `<QuestionFlow>` (upfront preset). On
 * submit, the parent closes the modal and dispatches a grading turn
 * into the Deep Dive thread — answers never flow through the chat
 * composer.
 */
export const QuizDialog: FC<QuizDialogProps> = ({
  open,
  onOpenChange,
  sourceType,
  recordId,
  sourceLabel,
  onComplete,
}) => {
  const [state, setState] = useState<State>({ status: "idle" });

  // Fetch when the dialog opens; reset when it closes so reopening
  // always produces a fresh quiz (the user may want a different set).
  useEffect(() => {
    if (!open) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    fetchQuiz(sourceType, recordId)
      .then((quiz) => {
        if (cancelled) return;
        if (quiz.steps.length === 0) {
          setState({ status: "error", message: "沒有可用的測驗題目。" });
        } else {
          setState({ status: "ready", quiz });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "無法產生測驗。",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceType, recordId]);

  const handleComplete = (answers: Record<string, string[]>) => {
    if (state.status !== "ready") return;
    onComplete(state.quiz, answers);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-4">
        <DialogHeader>
          <DialogTitle>小測驗</DialogTitle>
          <DialogDescription>
            {sourceLabel
              ? `根據「${sourceLabel}」出題，完成後由助理逐題講解。`
              : "完成後由助理逐題講解。"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-[16rem]">
          {state.status === "loading" && (
            <div className="flex h-64 items-center justify-center text-muted-foreground text-sm">
              產生測驗中…
            </div>
          )}
          {state.status === "error" && (
            <div className="flex h-64 items-center justify-center px-6 text-center text-destructive text-sm">
              {state.message}
            </div>
          )}
          {state.status === "ready" && (
            <QuestionFlow
              id={`quiz-${recordId}`}
              steps={state.quiz.steps}
              onComplete={handleComplete}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
