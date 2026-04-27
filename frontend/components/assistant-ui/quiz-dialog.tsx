"use client";

import { type FC, useEffect, useState } from "react";

import { Plan, type PlanTodo } from "@/components/tool-ui/plan";
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

// Cosmetic progression through three generation stages while the
// backend /quiz/generate call is in flight. Real progress would need
// SSE from the backend; a timer-driven advance is good enough here
// since the full fetch typically takes 5–10s.
const PLAN_STAGE_LABELS = ["閱讀來源內容", "草擬題目", "整理成測驗"] as const;
const PLAN_STAGE_INTERVAL_MS = 1500;

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
  const [activeStage, setActiveStage] = useState(0);

  // Fetch when the dialog opens; reset when it closes so reopening
  // always produces a fresh quiz (the user may want a different set).
  useEffect(() => {
    if (!open) {
      setState({ status: "idle" });
      setActiveStage(0);
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    setActiveStage(0);
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

  // While loading, tick activeStage forward every PLAN_STAGE_INTERVAL_MS
  // up to (but not past) the final stage — the final stage flips to
  // completed only when the fetch resolves.
  useEffect(() => {
    if (state.status !== "loading") return;
    const id = setInterval(() => {
      setActiveStage((i) => Math.min(i + 1, PLAN_STAGE_LABELS.length - 1));
    }, PLAN_STAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [state.status]);

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
            <div className="flex h-full items-center justify-center py-4">
              <Plan
                id={`quiz-plan-${recordId}`}
                title="產生測驗中"
                description="正在依據來源內容草擬題目"
                todos={buildPlanTodos(activeStage, "loading")}
              />
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

function buildPlanTodos(
  activeStage: number,
  phase: "loading" | "done",
): PlanTodo[] {
  return PLAN_STAGE_LABELS.map((label, idx) => {
    const status: PlanTodo["status"] =
      phase === "done" || idx < activeStage
        ? "completed"
        : idx === activeStage
          ? "in_progress"
          : "pending";
    return { id: String(idx + 1), label, status };
  });
}
