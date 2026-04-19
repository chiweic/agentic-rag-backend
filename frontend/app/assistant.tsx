"use client";

import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { DeepDiveProvider } from "@/components/assistant-ui/deep-dive-provider";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/thread-list-sidebar";
import {
  createThread,
  getThreadState,
  sendMessage,
  setTokenResolver as setChatApiToken,
} from "@/lib/chatApi";
import { clearFollowupSuggestions } from "@/lib/followupSuggestions";
import { setTokenResolver as setSourcesToken } from "@/lib/sources";
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

// Install resolvers before the runtime is created so initial thread requests
// do not race ahead unauthenticated on first render.
setChatApiToken(fetchAccessToken);
setAdapterToken(fetchAccessToken);
setSourcesToken(fetchAccessToken);

function useLangGraphRuntimeHook() {
  return useLangGraphRuntime({
    stream: async function* (messages, { initialize, command }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("Thread not found");

      clearFollowupSuggestions(externalId);
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
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useLangGraphRuntimeHook,
    adapter: threadListAdapter,
  });

  // DeepDiveProvider wraps the main AssistantRuntimeProvider so the
  // overlay's own AssistantRuntimeProvider (rendered via portal from
  // inside DeepDiveProvider) is NOT a descendant of the main runtime.
  // Otherwise the inner Thread reads thread-list state from the outer
  // runtime and shows the main chat's messages in the deep-dive pane.
  return (
    <DeepDiveProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <div className="flex h-full">
          <ThreadListSidebar />
          <div className="flex-1">
            <Thread />
          </div>
        </div>
      </AssistantRuntimeProvider>
    </DeepDiveProvider>
  );
}
