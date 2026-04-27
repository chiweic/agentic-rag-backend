export type QuizOption = {
  id: string;
  label: string;
  description?: string;
};

export type QuizQuestion = {
  id: string;
  title: string;
  description?: string;
  options: QuizOption[];
  selectionMode: "single";
  correctOptionIds: string[];
  explanation?: string;
};

export type Quiz = {
  steps: QuizQuestion[];
};

let tokenResolver: (() => Promise<string | null>) | null = null;

export function setQuizTokenResolver(resolver: () => Promise<string | null>) {
  tokenResolver = resolver;
}

async function fetchAccessTokenFallback(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/token");
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}

const getApiUrl = () =>
  process.env["NEXT_PUBLIC_LANGGRAPH_API_URL"] ||
  new URL("/api", window.location.href).href;

const getAuthHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const token = tokenResolver
    ? await tokenResolver()
    : await fetchAccessTokenFallback();
  if (token) headers["authorization"] = `Bearer ${token}`;
  return headers;
};

export async function fetchQuiz(
  sourceType: string,
  recordId: string,
  n = 4,
): Promise<Quiz> {
  const res = await fetch(`${getApiUrl()}/quiz/generate`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      source_type: sourceType,
      record_id: recordId,
      n,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to generate quiz: ${res.status}`);
  }
  return (await res.json()) as Quiz;
}

/**
 * Build the grading turn dispatched into the chat after the user
 * submits. Frontend already knows correct answers from the quiz
 * payload, so the prompt includes them — the assistant's job is to
 * explain *why*, grounded in the source (the Deep Dive runtime pins
 * `scope_record_id` on every turn).
 */
export function buildQuizGradingPrompt(
  quiz: Quiz,
  answers: Record<string, string[]>,
): string {
  const lines: string[] = ["我完成了這份測驗，請逐題評分並解釋原因。", ""];
  quiz.steps.forEach((step, idx) => {
    const chosen = answers[step.id] ?? [];
    const chosenLabels = chosen
      .map((id) => step.options.find((o) => o.id === id)?.label ?? id)
      .join("、");
    const correctLabels = step.correctOptionIds
      .map((id) => step.options.find((o) => o.id === id)?.label ?? id)
      .join("、");
    lines.push(`第 ${idx + 1} 題：${step.title}`);
    for (const opt of step.options) {
      lines.push(`  ${opt.id.toUpperCase()}. ${opt.label}`);
    }
    lines.push(`我的答案：${chosenLabels || "（未作答）"}`);
    lines.push(`正確答案：${correctLabels}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}
