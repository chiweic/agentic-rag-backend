"use client";

import { getAuthToken, invalidateAuthSession } from "@/lib/auth-store";

const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8081";

type BackendThread = {
  thread_id: string;
  title?: string | null;
  created_at?: number;
  is_archived?: boolean;
  metadata?: Record<string, unknown>;
};

export type BackendMessagePart = {
  type: "text";
  text: string;
};

export type BackendThreadMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: BackendMessagePart[];
};

export type BackendThreadState = {
  thread_id: string;
  messages: BackendThreadMessage[];
};

export type BackendRunStreamEvent =
  | { type: "messages/partial"; message: BackendThreadMessage }
  | { type: "messages/complete"; message: BackendThreadMessage }
  | { type: "values"; state: BackendThreadState }
  | { type: "error"; message: string }
  | { type: "end" };

export class BackendAuthError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "BackendAuthError";
  }
}

export class BackendRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BackendRequestError";
    this.status = status;
  }
}

const authHeaders = async (): Promise<Record<string, string>> => {
  const token = await getAuthToken();
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
};

const handleAuthFailure = (
  message = "Your session expired. Sign in again.",
) => {
  return invalidateAuthSession(message);
};

const requestJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    if (response.status === 401) {
      await handleAuthFailure();
      throw new BackendAuthError(message || "Unauthorized");
    }
    throw new BackendRequestError(
      response.status,
      message || "Backend request failed",
    );
  }

  return (await response.json()) as T;
};

export const createBackendThread = async () => {
  return await requestJson<BackendThread>("/threads", {
    method: "POST",
    body: JSON.stringify({}),
  });
};

export const listBackendThreads = async () => {
  return await requestJson<BackendThread[]>("/threads");
};

export const renameBackendThread = async (
  backendThreadId: string,
  title: string | null,
) => {
  await requestJson(`/threads/${backendThreadId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
};

export const deleteBackendThread = async (backendThreadId: string) => {
  await requestJson(`/threads/${backendThreadId}`, {
    method: "DELETE",
  });
};

export const getBackendThreadState = async (backendThreadId: string) => {
  return await requestJson<BackendThreadState>(
    `/threads/${backendThreadId}/state`,
  );
};

const parseStreamPayload = <T>(raw: string): T | null => {
  if (!raw || raw === "null") return null;
  return JSON.parse(raw) as T;
};

const normalizeStreamMessage = (
  payload: BackendThreadMessage | BackendThreadMessage[],
) => {
  return Array.isArray(payload) ? payload[0] : payload;
};

export async function* streamBackendThreadRun(
  backendThreadId: string,
  newUserMessage: string,
  signal?: AbortSignal,
): AsyncGenerator<BackendRunStreamEvent> {
  const response = await fetch(
    `${BACKEND_BASE_URL}/threads/${backendThreadId}/runs/stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeaders()),
      },
      body: JSON.stringify({
        input: {
          messages: [{ role: "user", content: newUserMessage }],
        },
      }),
      signal,
    },
  );

  if (!response.ok) {
    const message = await response.text();
    if (response.status === 401) {
      await handleAuthFailure();
      throw new BackendAuthError(message || "Unauthorized");
    }
    throw new BackendRequestError(
      response.status,
      message || "Backend request failed",
    );
  }

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
        const payload = parseStreamPayload<
          BackendThreadMessage | BackendThreadMessage[]
        >(payloadRaw);
        if (!payload) continue;
        yield {
          type: eventName,
          message: normalizeStreamMessage(payload),
        };
        continue;
      }

      if (eventName === "values") {
        const payload = parseStreamPayload<BackendThreadState>(payloadRaw);
        if (!payload) continue;
        yield {
          type: "values",
          state: payload,
        };
        continue;
      }

      if (eventName === "error") {
        const payload = parseStreamPayload<{ message?: string }>(payloadRaw);
        yield {
          type: "error",
          message: payload?.message ?? "Backend run failed.",
        };
        continue;
      }

      if (eventName === "end") {
        yield { type: "end" };
      }
    }
  }
}
