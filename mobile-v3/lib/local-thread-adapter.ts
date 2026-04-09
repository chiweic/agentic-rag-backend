import { createAssistantStream } from "assistant-stream";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  ExportedMessageRepository,
  ExportedMessageRepositoryItem,
} from "@assistant-ui/core/internal";
import type {
  ThreadMessage,
  ThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatItem,
  MessageFormatRepository,
} from "@assistant-ui/core";
import type {
  RemoteThreadInitializeResponse,
  RemoteThreadListAdapter,
  RemoteThreadListResponse,
  RemoteThreadMetadata,
} from "@assistant-ui/core";

const BASE_PREFIX = "@assistant-ui:";

let _userId: string | undefined;

/** Set the current user ID to scope all storage keys. */
export function setStorageUserId(userId: string | undefined) {
  _userId = userId;
}

function prefix() {
  return _userId ? `${BASE_PREFIX}${_userId}:` : BASE_PREFIX;
}

function threadsKey() {
  return `${prefix()}threads`;
}

function messagesKey(threadId: string) {
  return `${prefix()}messages:${threadId}`;
}

type StoredThreadMetadata = {
  remoteId: string;
  externalId?: string;
  status: "regular" | "archived";
  title?: string;
};

async function loadThreadMetadata(): Promise<StoredThreadMetadata[]> {
  const raw = await AsyncStorage.getItem(threadsKey());
  return raw ? (JSON.parse(raw) as StoredThreadMetadata[]) : [];
}

async function saveThreadMetadata(
  threads: StoredThreadMetadata[],
): Promise<void> {
  await AsyncStorage.setItem(threadsKey(), JSON.stringify(threads));
}

export const localThreadListAdapter: RemoteThreadListAdapter = {
  async list(): Promise<RemoteThreadListResponse> {
    const threads = await loadThreadMetadata();
    return {
      threads: threads.map((t) => ({
        remoteId: t.remoteId,
        externalId: t.externalId,
        status: t.status,
        title: t.title,
      })),
    };
  },

  async initialize(threadId: string): Promise<RemoteThreadInitializeResponse> {
    const threads = await loadThreadMetadata();
    if (!threads.some((t) => t.remoteId === threadId)) {
      threads.unshift({ remoteId: threadId, status: "regular" });
      await saveThreadMetadata(threads);
    }
    return { remoteId: threadId, externalId: undefined };
  },

  async rename(remoteId: string, newTitle: string): Promise<void> {
    const threads = await loadThreadMetadata();
    const thread = threads.find((t) => t.remoteId === remoteId);
    if (thread) {
      thread.title = newTitle;
      await saveThreadMetadata(threads);
    }
  },

  async archive(remoteId: string): Promise<void> {
    const threads = await loadThreadMetadata();
    const thread = threads.find((t) => t.remoteId === remoteId);
    if (thread) {
      thread.status = "archived";
      await saveThreadMetadata(threads);
    }
  },

  async unarchive(remoteId: string): Promise<void> {
    const threads = await loadThreadMetadata();
    const thread = threads.find((t) => t.remoteId === remoteId);
    if (thread) {
      thread.status = "regular";
      await saveThreadMetadata(threads);
    }
  },

  async delete(remoteId: string): Promise<void> {
    const threads = await loadThreadMetadata();
    const filtered = threads.filter((t) => t.remoteId !== remoteId);
    await saveThreadMetadata(filtered);
    await AsyncStorage.removeItem(messagesKey(remoteId));
  },

  async fetch(threadId: string): Promise<RemoteThreadMetadata> {
    const threads = await loadThreadMetadata();
    const thread = threads.find((t) => t.remoteId === threadId);
    if (!thread) throw new Error("Thread not found");
    return {
      remoteId: thread.remoteId,
      externalId: thread.externalId,
      status: thread.status,
      title: thread.title,
    };
  },

  async generateTitle(
    remoteId: string,
    messages: readonly ThreadMessage[],
  ) {
    const firstUserMsg = messages.find((m) => m.role === "user");
    let title = "New Chat";
    if (firstUserMsg) {
      const textPart = firstUserMsg.content.find((c) => c.type === "text");
      if (textPart && textPart.type === "text") {
        title =
          textPart.text.length > 50
            ? textPart.text.slice(0, 50) + "…"
            : textPart.text;
      }
    }

    // Update stored title
    const threads = await loadThreadMetadata();
    const thread = threads.find((t) => t.remoteId === remoteId);
    if (thread) {
      thread.title = title;
      await saveThreadMetadata(threads);
    }

    return createAssistantStream((controller) => {
      controller.appendText(title);
    });
  },

  unstable_Provider: undefined, // we provide history via adapters instead
};

/**
 * History adapter that persists messages to AsyncStorage.
 * Implements withFormat to work with useExternalHistory.
 */
export function createLocalHistoryAdapter(
  getRemoteId: () => string | undefined,
): ThreadHistoryAdapter {
  return {
    async load(): Promise<ExportedMessageRepository> {
      const remoteId = getRemoteId();
      if (!remoteId) return { messages: [] };
      const raw = await AsyncStorage.getItem(messagesKey(remoteId));
      if (!raw) return { messages: [] };
      return JSON.parse(raw) as ExportedMessageRepository;
    },

    async append(item: ExportedMessageRepositoryItem): Promise<void> {
      const remoteId = getRemoteId();
      if (!remoteId) return;

      const key = messagesKey(remoteId);
      const raw = await AsyncStorage.getItem(key);
      const repo: ExportedMessageRepository = raw
        ? (JSON.parse(raw) as ExportedMessageRepository)
        : { messages: [] };

      const idx = repo.messages.findIndex(
        (m) => m.message.id === item.message.id,
      );
      if (idx >= 0) {
        repo.messages[idx] = item;
      } else {
        repo.messages.push(item);
      }
      repo.headId = item.message.id;
      await AsyncStorage.setItem(key, JSON.stringify(repo));
    },

    withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
      formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>,
    ) {
      const getRemoteIdRef = getRemoteId;
      return {
        async load(): Promise<MessageFormatRepository<TMessage>> {
          const remoteId = getRemoteIdRef();
          if (!remoteId) return { messages: [] };

          const raw = await AsyncStorage.getItem(messagesKey(remoteId));
          if (!raw) return { messages: [] };

          const stored = JSON.parse(raw) as {
            headId?: string;
            messages: Array<{
              id: string;
              parent_id: string | null;
              format: string;
              content: TStorageFormat;
            }>;
          };

          return {
            headId: stored.headId,
            messages: stored.messages.map((entry) => formatAdapter.decode(entry)),
          };
        },

        async append(item: MessageFormatItem<TMessage>): Promise<void> {
          const remoteId = getRemoteIdRef();
          if (!remoteId) return;

          const key = messagesKey(remoteId);
          const raw = await AsyncStorage.getItem(key);
          const stored = raw
            ? JSON.parse(raw)
            : { messages: [] };

          const encoded = formatAdapter.encode(item);
          const id = formatAdapter.getId(item.message);
          const entry = {
            id,
            parent_id: item.parentId,
            format: formatAdapter.format,
            content: encoded,
          };

          const idx = stored.messages.findIndex(
            (m: { id: string }) => m.id === id,
          );
          if (idx >= 0) {
            stored.messages[idx] = entry;
          } else {
            stored.messages.push(entry);
          }
          stored.headId = id;
          await AsyncStorage.setItem(key, JSON.stringify(stored));
        },

        async update(
          item: MessageFormatItem<TMessage>,
          localMessageId: string,
        ): Promise<void> {
          const remoteId = getRemoteIdRef();
          if (!remoteId) return;

          const key = messagesKey(remoteId);
          const raw = await AsyncStorage.getItem(key);
          if (!raw) return;

          const stored = JSON.parse(raw);
          const encoded = formatAdapter.encode(item);
          const id = formatAdapter.getId(item.message);
          const entry = {
            id,
            parent_id: item.parentId,
            format: formatAdapter.format,
            content: encoded,
          };

          const idx = stored.messages.findIndex(
            (m: { id: string }) => m.id === localMessageId,
          );
          if (idx >= 0) {
            stored.messages[idx] = entry;
          }
          await AsyncStorage.setItem(key, JSON.stringify(stored));
        },
      };
    },
  };
}
