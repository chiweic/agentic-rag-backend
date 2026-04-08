import type { RemoteThreadListAdapter } from "@assistant-ui/react";
import type { AssistantStreamChunk } from "assistant-stream";

let tokenResolver: (() => Promise<string | null>) | null = null;

export function setTokenResolver(resolver: () => Promise<string | null>) {
  tokenResolver = resolver;
}

const getBaseUrl = () =>
  process.env["NEXT_PUBLIC_LANGGRAPH_API_URL"] ||
  new URL("/api", window.location.href).href;

const authHeaders = async (): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (tokenResolver) {
    const token = await tokenResolver();
    if (token) {
      headers["authorization"] = `Bearer ${token}`;
    }
  }
  return headers;
};

export const threadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const res = await fetch(`${getBaseUrl()}/threads`, {
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list threads: ${res.status}`);
    const threads = await res.json();
    return {
      threads: threads.map(
        (t: { thread_id: string; title?: string; is_archived?: boolean }) => ({
          remoteId: t.thread_id,
          externalId: t.thread_id,
          title: t.title ?? undefined,
          status: t.is_archived ? ("archived" as const) : ("regular" as const),
        }),
      ),
    };
  },

  async initialize(threadId: string) {
    const res = await fetch(`${getBaseUrl()}/threads`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error(`Failed to create thread: ${res.status}`);
    const data = await res.json();
    return {
      remoteId: data.thread_id,
      externalId: data.thread_id,
    };
  },

  async rename(remoteId: string, newTitle: string) {
    const res = await fetch(`${getBaseUrl()}/threads/${remoteId}`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ title: newTitle }),
    });
    if (!res.ok) throw new Error(`Failed to rename thread: ${res.status}`);
  },

  async archive(remoteId: string) {
    const res = await fetch(`${getBaseUrl()}/threads/${remoteId}`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ is_archived: true }),
    });
    if (!res.ok) throw new Error(`Failed to archive thread: ${res.status}`);
  },

  async unarchive(remoteId: string) {
    const res = await fetch(`${getBaseUrl()}/threads/${remoteId}`, {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify({ is_archived: false }),
    });
    if (!res.ok) throw new Error(`Failed to unarchive thread: ${res.status}`);
  },

  async delete(remoteId: string) {
    const res = await fetch(`${getBaseUrl()}/threads/${remoteId}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to delete thread: ${res.status}`);
  },

  async generateTitle(remoteId: string) {
    const res = await fetch(
      `${getBaseUrl()}/threads/${remoteId}/generate-title`,
      {
        method: "POST",
        headers: await authHeaders(),
      },
    );
    if (!res.ok) throw new Error(`Failed to generate title: ${res.status}`);
    const data = await res.json();
    const title: string = data.title ?? "Untitled";
    return new ReadableStream<AssistantStreamChunk>({
      start(controller) {
        controller.enqueue({
          path: [0],
          type: "part-start",
          part: { type: "text" },
        });
        controller.enqueue({
          path: [0],
          type: "text-delta",
          textDelta: title,
        });
        controller.enqueue({
          path: [0],
          type: "part-finish",
        });
        controller.close();
      },
    });
  },

  async fetch(remoteId: string) {
    const res = await fetch(`${getBaseUrl()}/threads/${remoteId}`, {
      headers: await authHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch thread: ${res.status}`);
    const t = await res.json();
    return {
      remoteId: t.thread_id,
      externalId: t.thread_id,
      title: t.title ?? undefined,
      status: t.is_archived ? ("archived" as const) : ("regular" as const),
    };
  },
};
