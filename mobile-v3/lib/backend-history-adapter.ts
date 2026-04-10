import type {
  ThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatItem,
  MessageFormatRepository,
  GenericThreadHistoryAdapter,
  ThreadMessageLike,
} from "@assistant-ui/core";
import {
  ExportedMessageRepository,
  type ExportedMessageRepositoryItem,
} from "@assistant-ui/core/internal";

const BACKEND_BASE_URL =
  (process.env.EXPO_PUBLIC_BACKEND_BASE_URL ?? "http://localhost:8081").replace(
    /\/$/,
    "",
  );

type BackendMessagePart = { type: "text"; text: string };

type BackendThreadMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: BackendMessagePart[];
};

type BackendThreadState = {
  thread_id: string;
  messages: BackendThreadMessage[];
};

async function fetchThreadState(
  remoteId: string,
  getAccessToken: () => Promise<string | null>,
): Promise<BackendThreadMessage[]> {
  const token = await getAccessToken();
  const response = await fetch(
    `${BACKEND_BASE_URL}/threads/${remoteId}/state`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Backend ${response.status}: ${await response.text()}`);
  }

  const state = (await response.json()) as BackendThreadState;
  return state.messages ?? [];
}

/**
 * Convert backend messages to UIMessage format (with `parts` array).
 * The AI SDK format adapter expects `parts`, not `content`.
 */
function toUIMessages(backendMessages: BackendThreadMessage[]) {
  return backendMessages
    .filter((msg) => msg.role !== "tool")
    .map((msg) => ({
      id: msg.id || crypto.randomUUID(),
      role: msg.role as "user" | "assistant" | "system",
      parts: msg.content.map((part) => ({
        type: "text" as const,
        text: part.text,
      })),
      createdAt: new Date(),
    }));
}

/**
 * Creates a ThreadHistoryAdapter that loads messages from the backend's
 * GET /threads/{id}/state endpoint.
 *
 * Implements withFormat() so useExternalHistory can load messages in the
 * AI SDK's format adapter pipeline (which expects UIMessage with `parts`).
 */
export function createBackendHistoryAdapter(
  getRemoteId: () => string | undefined,
  getAccessToken: () => Promise<string | null>,
): ThreadHistoryAdapter {
  return {
    async load(): Promise<ExportedMessageRepository> {
      const remoteId = getRemoteId();
      if (!remoteId) return { messages: [] };

      try {
        const backendMessages = await fetchThreadState(remoteId, getAccessToken);
        if (backendMessages.length === 0) return { messages: [] };

        const messageLikes: ThreadMessageLike[] = backendMessages
          .filter((msg) => msg.role !== "tool")
          .map((msg) => ({
            id: msg.id || undefined,
            role: msg.role as "user" | "assistant" | "system",
            content: msg.content.map((part) => ({
              type: "text" as const,
              text: part.text,
            })),
          }));

        return ExportedMessageRepository.fromArray(messageLikes);
      } catch (err) {
        console.warn("Failed to load thread history from backend:", err);
        return { messages: [] };
      }
    },

    async append(_item: ExportedMessageRepositoryItem): Promise<void> {
      // No-op: the backend persists messages through the LangGraph checkpointer
    },

    withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
      formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
    ): GenericThreadHistoryAdapter<TMessage> {
      const getRemoteIdRef = getRemoteId;
      const getAccessTokenRef = getAccessToken;

      return {
        async load(): Promise<MessageFormatRepository<TMessage>> {
          const remoteId = getRemoteIdRef();
          if (!remoteId) return { messages: [] };

          try {
            const backendMessages = await fetchThreadState(
              remoteId,
              getAccessTokenRef,
            );
            if (backendMessages.length === 0) return { messages: [] };

            // Create UIMessage objects with `parts` (not `content`)
            // so the AI SDK format adapter can encode/decode properly.
            const uiMessages = toUIMessages(backendMessages);

            const items: MessageFormatItem<TMessage>[] = uiMessages.map(
              (msg, idx) => {
                const parentId =
                  idx > 0
                    ? formatAdapter.getId(
                        uiMessages[idx - 1] as unknown as TMessage,
                      )
                    : null;

                // Round-trip through encode/decode to match expected format
                const encoded = formatAdapter.encode({
                  parentId,
                  message: msg as unknown as TMessage,
                });
                const storageEntry = {
                  id: formatAdapter.getId(msg as unknown as TMessage),
                  parent_id: parentId,
                  format: formatAdapter.format,
                  content: encoded,
                };
                return formatAdapter.decode(storageEntry);
              },
            );

            const lastId =
              uiMessages.length > 0
                ? formatAdapter.getId(
                    uiMessages[uiMessages.length - 1] as unknown as TMessage,
                  )
                : undefined;

            return {
              headId: lastId,
              messages: items,
            };
          } catch (err) {
            console.warn(
              "Failed to load thread history from backend:",
              err,
            );
            return { messages: [] };
          }
        },

        async append(_item: MessageFormatItem<TMessage>): Promise<void> {
          // No-op: the backend persists messages through the LangGraph checkpointer
        },
      };
    },
  };
}
