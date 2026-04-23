"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { Thread } from "@/components/assistant-ui/thread";
import { createThread, getThreadState, sendMessage } from "@/lib/chatApi";

/**
 * `/sheng-yen` — 聖嚴師父身影 Thread chat (features_v3.md §1).
 *
 * Standalone assistant runtime scoped to three rag_bot corpora:
 * `audio`, `video_ddmtv01`, `video_ddmtv02`. Each run carries
 * `metadata.source_types` so the backend retrieve node fans out one
 * search per corpus and round-robin merges the hits (see
 * `app/agent/nodes.py::_multi_source_search`).
 *
 * Thread is ephemeral per page visit (marked `deep_dive: true` plus
 * `kind: "sheng_yen"` so it's hidden from the main sidebar list,
 * mirroring the /events pattern).
 *
 * Commit-2 shell: runtime + route only. The per-tab welcome cards +
 * in-chat media citations land in commits 4–5.
 */
const SOURCE_TYPES = ["audio", "video_ddmtv01", "video_ddmtv02"] as const;

export default function ShengYenPage() {
  const runtime = useShengYenRuntime();
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="h-full">
        <Thread />
      </main>
    </AssistantRuntimeProvider>
  );
}

const useShengYenRuntime = () => {
  return useLangGraphRuntime({
    stream: async function* (messages, { initialize, command }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("Sheng-yen thread missing");
      yield* sendMessage({
        threadId: externalId,
        messages,
        command,
        metadata: { source_types: [...SOURCE_TYPES] },
      });
    },
    create: async () => {
      const { thread_id } = await createThread({
        kind: "sheng_yen",
        deep_dive: true,
        sources: [...SOURCE_TYPES],
      });
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      const state = await getThreadState(externalId);
      return { messages: state.messages };
    },
  });
};
