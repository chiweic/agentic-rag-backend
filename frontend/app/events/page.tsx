"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { EventsScopeContext } from "@/components/assistant-ui/events-welcome";
import { Thread } from "@/components/assistant-ui/thread";
import { createThread, getThreadState, sendMessage } from "@/lib/chatApi";

/**
 * `/events` — event-recommendations Thread chat (features_v2.md §4a).
 *
 * Standalone assistant runtime scoped to the "events" source on
 * rag_bot. Empty-state renders the user's personalised recommendation
 * cards (see EventsWelcome via EventsScopeContext). Each run carries
 * `metadata.source_type = "events"` so retrieval uses the events
 * corpus rather than the default faguquanji.
 *
 * Thread is ephemeral per page visit (marked `deep_dive: true` plus
 * `kind: "events"` so it's hidden from the main sidebar thread list).
 */
export default function EventsPage() {
  const runtime = useEventsRuntime();
  return (
    <EventsScopeContext.Provider value={true}>
      <AssistantRuntimeProvider runtime={runtime}>
        <main className="h-full">
          <Thread />
        </main>
      </AssistantRuntimeProvider>
    </EventsScopeContext.Provider>
  );
}

/**
 * LangGraph runtime tailored to the events tab: lazily creates a
 * scoped thread on first send and tags every run with
 * `source_type: "events"` so the backend retrieve node swaps corpora
 * (see app/agent/nodes.py `source_type = state.source_type or
 * settings.default_source_type`).
 */
const useEventsRuntime = () => {
  return useLangGraphRuntime({
    stream: async function* (messages, { initialize, command }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("Events thread missing");
      yield* sendMessage({
        threadId: externalId,
        messages,
        command,
        metadata: { source_type: "events" },
      });
    },
    create: async () => {
      const { thread_id } = await createThread({
        kind: "events",
        // Reuse the existing "hidden from sidebar" filter that
        // thread_metadata.list_threads applies to deep-dive threads —
        // functionally this thread is also a scoped, ephemeral
        // companion chat, not a first-class conversation.
        deep_dive: true,
        source: { source_type: "events" },
      });
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      const state = await getThreadState(externalId);
      return { messages: state.messages };
    },
  });
};
