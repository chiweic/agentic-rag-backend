"use client";

import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { useRef } from "react";
import { DeepDiveProvider } from "@/components/assistant-ui/deep-dive-provider";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/thread-list-sidebar";
import {
  createThread,
  getThreadState,
  sendMessage,
  setTokenResolver as setChatApiToken,
} from "@/lib/chatApi";
import {
  createFeedbackAdapter,
  setFeedbackTokenResolver,
} from "@/lib/feedbackAdapter";
import { clearFollowupSuggestions } from "@/lib/followupSuggestions";
import { setQuizTokenResolver } from "@/lib/quiz";
import { setTokenResolver as setSourcesToken } from "@/lib/sources";
import {
  setTokenResolver as setAdapterToken,
  threadListAdapter,
} from "@/lib/threadListAdapter";
import { consumeVoiceInputFlag } from "@/lib/voiceInput";

/** Fetch the access token from the server-side Logto session. */
async function fetchAccessToken(): Promise<string | null> {
  const res = await fetch("/api/auth/token");
  if (!res.ok) return null;
  const data = await res.json();
  return data.accessToken ?? null;
}

// navigator.clipboard is only exposed on secure contexts (HTTPS or
// localhost). When this app is served over plain HTTP on a LAN IP,
// `navigator.clipboard` is undefined and assistant-ui's Copy primitive
// throws "Cannot read properties of undefined (reading 'writeText')".
// Shim a `writeText` that uses the legacy execCommand fallback so the
// Copy button keeps working in those environments.
if (typeof navigator !== "undefined" && !navigator.clipboard) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText(text: string): Promise<void> {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "0";
        ta.style.left = "0";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
          const ok = document.execCommand("copy");
          return ok
            ? Promise.resolve()
            : Promise.reject(new Error("execCommand copy failed"));
        } finally {
          document.body.removeChild(ta);
        }
      },
    },
  });
}

// Install resolvers before the runtime is created so initial thread requests
// do not race ahead unauthenticated on first render.
setChatApiToken(fetchAccessToken);
setAdapterToken(fetchAccessToken);
setSourcesToken(fetchAccessToken);
setQuizTokenResolver(fetchAccessToken);
setFeedbackTokenResolver(fetchAccessToken);

function useLangGraphRuntimeHook() {
  // Tracks the most recent thread id touched by stream/load so the
  // FeedbackAdapter (which only gets {message, type}) can tag its
  // POST with the correct thread. Kept as a ref so updating it
  // doesn't force a runtime rebuild.
  const activeThreadIdRef = useRef<string | null>(null);

  return useLangGraphRuntime({
    stream: async function* (messages, { initialize, command }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("Thread not found");

      activeThreadIdRef.current = externalId;
      clearFollowupSuggestions(externalId);
      const metadata = consumeVoiceInputFlag()
        ? { input_mode: "voice" }
        : undefined;
      yield* sendMessage({
        threadId: externalId,
        messages,
        command,
        metadata,
      });
    },
    create: async () => {
      const { thread_id } = await createThread();
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      activeThreadIdRef.current = externalId;
      const state = await getThreadState(externalId);
      return {
        messages: state.messages,
      };
    },
    adapters: {
      feedback: createFeedbackAdapter(() => activeThreadIdRef.current),
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
