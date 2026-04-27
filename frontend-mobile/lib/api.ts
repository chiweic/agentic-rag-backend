import { getAccessToken } from "./auth";
import { parseSseStream } from "./sse";

export type Citation = {
  chunk_id: string;
  text: string;
  title: string;
  source_url: string | null;
  score: number | null;
  metadata: {
    source_type: string;
    record_id?: string;
    chunk_index?: number;
    publish_date?: string | null;
    book_title?: string;
    chapter_title?: string;
    category?: string;
    attribution?: string;
    series_name?: string;
    unit_name?: string;
    playback_url?: string;
    duration_s?: number;
    start_s?: number;
    end_s?: number;
  };
};

export type TextPart = { type: "text"; text: string };
export type CitationsPart = { type: "citations"; citations: Citation[] };
export type ContentPart = TextPart | CitationsPart;

export type Message = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  citations: Citation[];
};

export type Thread = {
  thread_id: string;
  title?: string;
  is_archived?: boolean;
  created_at?: string;
};

type BackendMessage = {
  id: string;
  role: string;
  content: ContentPart[] | string;
};

const API_BASE = "/api";

function genId(): string {
  // crypto.randomUUID requires a secure context (HTTPS / localhost). Mobile
  // dev hits the LAN IP over plain HTTP, where it's undefined. Fall back to
  // a non-cryptographic id — the backend re-IDs messages on its side anyway.
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `u-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = await getAccessToken();
  if (token) headers["authorization"] = `Bearer ${token}`;
  return headers;
}

function normalizeMessage(m: BackendMessage): Message {
  if (typeof m.content === "string") {
    return {
      id: m.id,
      role: (m.role as Message["role"]) ?? "assistant",
      text: m.content,
      citations: [],
    };
  }
  const text = m.content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");
  const citations = m.content.flatMap((p) =>
    p.type === "citations" ? p.citations : [],
  );
  return {
    id: m.id,
    role: (m.role as Message["role"]) ?? "assistant",
    text,
    citations,
  };
}

export async function listThreads(): Promise<Thread[]> {
  const res = await fetch(`${API_BASE}/threads`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`listThreads ${res.status}`);
  return res.json();
}

export async function createThread(
  metadata?: Record<string, unknown>,
): Promise<Thread> {
  const res = await fetch(`${API_BASE}/threads`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(metadata ? { metadata } : {}),
  });
  if (!res.ok) throw new Error(`createThread ${res.status}`);
  return res.json();
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/threads/${threadId}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`deleteThread ${res.status}`);
}

export async function renameThread(threadId: string, title: string): Promise<void> {
  const res = await fetch(`${API_BASE}/threads/${threadId}`, {
    method: "PATCH",
    headers: await authHeaders(),
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`renameThread ${res.status}`);
}

export async function generateTitle(threadId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/generate-title`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`generateTitle ${res.status}`);
  const data = await res.json();
  return data.title ?? "Untitled";
}

export async function getThreadState(
  threadId: string,
): Promise<{ messages: Message[] }> {
  const res = await fetch(`${API_BASE}/threads/${threadId}/state`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(`getThreadState ${res.status}`);
  const data = await res.json();
  return { messages: (data.messages ?? []).map(normalizeMessage) };
}

export type StreamUpdate =
  | { kind: "partial"; message: Message }
  | { kind: "complete"; message: Message }
  | { kind: "values"; messages: Message[] };

/**
 * Send a user message and yield progressive stream updates. Caller renders
 * `partial` updates as they arrive; `complete` carries the finalized assistant
 * message; `values` carries the post-run thread snapshot (with citations).
 */
export async function* sendStream(params: {
  threadId: string;
  text: string;
  metadata?: Record<string, unknown>;
}): AsyncGenerator<StreamUpdate> {
  const body: Record<string, unknown> = {
    input: {
      messages: [{ id: genId(), role: "user", content: params.text }],
    },
    streamMode: ["messages", "updates"],
  };
  if (params.metadata && Object.keys(params.metadata).length > 0) {
    body.metadata = params.metadata;
  }

  const res = await fetch(`${API_BASE}/threads/${params.threadId}/runs/stream`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`sendStream ${res.status}`);

  for await (const ev of parseSseStream(res.body)) {
    let data: unknown;
    try {
      data = JSON.parse(ev.data);
    } catch {
      continue;
    }
    if (ev.event === "messages/partial") {
      yield { kind: "partial", message: normalizeMessage(data as BackendMessage) };
    } else if (ev.event === "messages/complete") {
      yield { kind: "complete", message: normalizeMessage(data as BackendMessage) };
    } else if (
      ev.event === "values" &&
      data &&
      typeof data === "object" &&
      Array.isArray((data as { messages?: unknown }).messages)
    ) {
      const msgs = ((data as { messages: BackendMessage[] }).messages).map(
        normalizeMessage,
      );
      yield { kind: "values", messages: msgs };
    }
  }
}
