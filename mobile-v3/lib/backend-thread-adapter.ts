import { createAssistantStream } from "assistant-stream";
import type {
  RemoteThreadInitializeResponse,
  RemoteThreadListAdapter,
  RemoteThreadListResponse,
  RemoteThreadMetadata,
} from "@assistant-ui/core";
import type { ThreadMessage } from "@assistant-ui/core";

const BACKEND_BASE_URL =
  (process.env.EXPO_PUBLIC_BACKEND_BASE_URL ?? "http://localhost:8081").replace(
    /\/$/,
    "",
  );

type BackendThread = {
  thread_id: string;
  title?: string | null;
  created_at?: number;
  is_archived?: boolean;
  metadata?: Record<string, unknown>;
};

type BackendMessagePart = { type: "text"; text: string };

type BackendThreadMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: BackendMessagePart[];
};

export type BackendRunStreamEvent =
  | { type: "messages/partial"; message: BackendThreadMessage }
  | { type: "messages/complete"; message: BackendThreadMessage }
  | {
      type: "values";
      state: { thread_id: string; messages: BackendThreadMessage[] };
    }
  | { type: "error"; message: string }
  | { type: "end" };

async function requestJson<T>(
  path: string,
  getAccessToken: () => Promise<string | null>,
  init?: RequestInit,
): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Backend ${response.status}: ${message}`);
  }

  return (await response.json()) as T;
}

export function createBackendThreadListAdapter(
  getAccessToken: () => Promise<string | null>,
): RemoteThreadListAdapter {
  return {
    async list(): Promise<RemoteThreadListResponse> {
      const threads = await requestJson<BackendThread[]>(
        "/threads",
        getAccessToken,
      );
      return {
        threads: threads.map((t) => ({
          remoteId: t.thread_id,
          status: t.is_archived ? ("archived" as const) : ("regular" as const),
          title: t.title ?? undefined,
        })),
      };
    },

    async initialize(
      _threadId: string,
    ): Promise<RemoteThreadInitializeResponse> {
      const thread = await requestJson<BackendThread>("/threads", getAccessToken, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return { remoteId: thread.thread_id, externalId: undefined };
    },

    async rename(remoteId: string, newTitle: string): Promise<void> {
      await requestJson(`/threads/${remoteId}`, getAccessToken, {
        method: "PATCH",
        body: JSON.stringify({ title: newTitle }),
      });
    },

    async archive(remoteId: string): Promise<void> {
      await requestJson(`/threads/${remoteId}`, getAccessToken, {
        method: "PATCH",
        body: JSON.stringify({ is_archived: true }),
      });
    },

    async unarchive(remoteId: string): Promise<void> {
      await requestJson(`/threads/${remoteId}`, getAccessToken, {
        method: "PATCH",
        body: JSON.stringify({ is_archived: false }),
      });
    },

    async delete(remoteId: string): Promise<void> {
      await requestJson(`/threads/${remoteId}`, getAccessToken, {
        method: "DELETE",
      });
    },

    async fetch(threadId: string): Promise<RemoteThreadMetadata> {
      const threads = await requestJson<BackendThread[]>(
        "/threads",
        getAccessToken,
      );
      const thread = threads.find((t) => t.thread_id === threadId);
      if (!thread) throw new Error("Thread not found");
      return {
        remoteId: thread.thread_id,
        status: thread.is_archived ? "archived" : "regular",
        title: thread.title ?? undefined,
      };
    },

    async generateTitle(
      remoteId: string,
      messages: readonly ThreadMessage[],
    ) {
      try {
        const result = await requestJson<{ thread_id: string; title: string }>(
          `/threads/${remoteId}/generate-title`,
          getAccessToken,
          { method: "POST" },
        );
        return createAssistantStream((controller) => {
          controller.appendText(result.title);
        });
      } catch {
        // Backend returns 400 if thread has no messages yet.
        // Fall back to the first user message text.
        const firstUser = messages.find((m) => m.role === "user");
        const text =
          firstUser?.content
            .filter((p): p is Extract<typeof p, { type: "text" }> => p.type === "text")
            .map((p) => p.text)
            .join(" ") ?? "New Chat";
        const title = text.length > 50 ? text.slice(0, 50) + "…" : text;
        return createAssistantStream((controller) => {
          controller.appendText(title);
        });
      }
    },

    unstable_Provider: undefined,
  };
}

/**
 * Parse SSE events from a backend /threads/{id}/runs/stream response.
 */
export async function* parseBackendSSE(
  response: Response,
): AsyncGenerator<BackendRunStreamEvent> {
  if (!response.body) {
    throw new Error("The backend did not return a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      if (!chunk.trim()) continue;

      const lines = chunk.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLines = lines
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6));

      const eventName = eventLine?.slice(7).trim();
      const payloadRaw = dataLines.join("\n").trim();

      if (!eventName) continue;

      if (
        eventName === "messages/partial" ||
        eventName === "messages/complete"
      ) {
        if (!payloadRaw || payloadRaw === "null") continue;
        const payload = JSON.parse(payloadRaw);
        const message = Array.isArray(payload) ? payload[0] : payload;
        yield { type: eventName, message };
        continue;
      }

      if (eventName === "values") {
        if (!payloadRaw || payloadRaw === "null") continue;
        yield { type: "values", state: JSON.parse(payloadRaw) };
        continue;
      }

      if (eventName === "error") {
        const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
        yield { type: "error", message: payload?.message ?? "Backend run failed." };
        continue;
      }

      if (eventName === "end") {
        yield { type: "end" };
      }
    }
  }
}
