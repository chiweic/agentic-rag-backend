"use client";

import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { useEffect } from "react";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/thread-list-sidebar";
import {
  createThread,
  getThreadState,
  sendMessage,
  setTokenResolver as setChatApiToken,
} from "@/lib/chatApi";
import {
  setTokenResolver as setAdapterToken,
  threadListAdapter,
} from "@/lib/threadListAdapter";

/** Fetch the access token from the server-side Logto session. */
async function fetchAccessToken(): Promise<string | null> {
  const res = await fetch("/api/auth/token");
  if (!res.ok) return null;
  const data = await res.json();
  return data.accessToken ?? null;
}

function useLangGraphRuntimeHook() {
  return useLangGraphRuntime({
    stream: async function* (messages, { initialize, command }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("Thread not found");

      yield* sendMessage({
        threadId: externalId,
        messages,
        command,
      });
    },
    create: async () => {
      const { thread_id } = await createThread();
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      const state = await getThreadState(externalId);
      return {
        messages: state.messages,
      };
    },
  });
}

export function Assistant() {
  useEffect(() => {
    setChatApiToken(fetchAccessToken);
    setAdapterToken(fetchAccessToken);
  }, []);

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useLangGraphRuntimeHook,
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-full">
        <ThreadListSidebar />
        <div className="flex-1">
          <Thread />
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
