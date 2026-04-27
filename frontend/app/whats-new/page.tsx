"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { Thread } from "@/components/assistant-ui/thread";
import { WhatsNewScopeContext } from "@/components/assistant-ui/whats-new-welcome";
import { createThread, getThreadState, sendMessage } from "@/lib/chatApi";
import { consumeVoiceInputFlag } from "@/lib/voiceInput";

/**
 * `/whats-new` — 新鮮事 Thread chat (features_v4.md §1).
 *
 * Standalone assistant runtime scoped to six rag_bot corpora:
 * `news` + `faguquanji` + `audio` + `video_ddmtv01` +
 * `video_ddmtv02` + `video_ddmmedia1321`. Every run carries
 * `metadata.source_types` so retrieve fans out + round-robin merges
 * (modality priority from v3 §1 keeps videos above audio), plus
 * `metadata.generate_variant = "sheng_yen"` so the rag_bot
 * provider prepends a style directive steering answers toward the
 * master's voice.
 *
 * Thread is ephemeral per page visit, marked `deep_dive: true` plus
 * `kind: "whats_new"` so it stays hidden from the main sidebar list
 * (same pattern as /events and /sheng-yen).
 */
const SOURCE_TYPES = [
  "news",
  "faguquanji",
  "audio",
  "video_ddmtv01",
  "video_ddmtv02",
  "video_ddmmedia1321",
] as const;

export default function WhatsNewPage() {
  const runtime = useWhatsNewRuntime();
  return (
    <WhatsNewScopeContext.Provider value={true}>
      <AssistantRuntimeProvider runtime={runtime}>
        <main className="h-full">
          <Thread />
        </main>
      </AssistantRuntimeProvider>
    </WhatsNewScopeContext.Provider>
  );
}

const useWhatsNewRuntime = () => {
  return useLangGraphRuntime({
    stream: async function* (messages, { initialize, command }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("Whats-new thread missing");
      const metadata: Record<string, unknown> = {
        source_types: [...SOURCE_TYPES],
        generate_variant: "sheng_yen",
      };
      if (consumeVoiceInputFlag()) metadata.input_mode = "voice";
      yield* sendMessage({
        threadId: externalId,
        messages,
        command,
        metadata,
      });
    },
    create: async () => {
      const { thread_id } = await createThread({
        kind: "whats_new",
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
