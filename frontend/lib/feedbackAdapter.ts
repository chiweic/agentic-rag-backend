import type { FeedbackAdapter } from "@assistant-ui/react";

let tokenResolver: (() => Promise<string | null>) | null = null;

export function setFeedbackTokenResolver(
  resolver: () => Promise<string | null>,
) {
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

/**
 * Factory that builds an assistant-ui `FeedbackAdapter` wired to our
 * backend's `POST /api/feedback`. The thread id isn't on the message,
 * so the caller (assistant.tsx) passes a resolver that reads the
 * currently-active thread id from the runtime.
 *
 * Failures are swallowed on purpose: a dropped reaction is not worth
 * an error toast. Log and move on.
 */
export function createFeedbackAdapter(
  getThreadId: () => string | null,
): FeedbackAdapter {
  return {
    submit: ({ message, type }) => {
      const threadId = getThreadId();
      if (!threadId || !message.id) return;
      // Skip the round-trip when the user re-clicks the thumb they
      // already selected. Backend would upsert to the same value
      // anyway; this saves a wasted POST per repeat click.
      if (message.metadata?.submittedFeedback?.type === type) return;
      // Fire and forget — don't block the UI on a feedback write.
      void submit(threadId, message.id, type);
    },
  };
}

async function submit(
  threadId: string,
  messageId: string,
  feedback: "positive" | "negative",
): Promise<void> {
  try {
    const res = await fetch(`${getApiUrl()}/feedback`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        thread_id: threadId,
        message_id: messageId,
        feedback,
      }),
    });
    if (!res.ok) {
      console.warn(
        `feedback submit failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  } catch (err) {
    console.warn("feedback submit error", err);
  }
}
