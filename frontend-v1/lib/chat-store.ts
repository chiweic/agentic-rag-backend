"use client";

import type { ThreadMessageLike } from "@assistant-ui/react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThreadSyncStatus = "local" | "linked" | "syncing" | "error";
export type ThreadHistorySource = "local" | "backend";
export type ThreadHistoryLoadStatus = "idle" | "loading" | "loaded" | "error";

export type ChatThread = {
  id: string;
  backendThreadId: string | null;
  title: string | null;
  messages: readonly ThreadMessageLike[];
  createdAt: number;
  updatedAt: number;
  syncStatus: ThreadSyncStatus;
  lastSyncedAt: number | null;
  historySource: ThreadHistorySource;
  historyLoaded: boolean;
  historyLoadStatus: ThreadHistoryLoadStatus;
};

export type BackendThreadMetadata = {
  thread_id: string;
  title?: string | null;
  created_at?: number;
};

type ChatState = {
  threadOrder: string[];
  threads: Record<string, ChatThread>;
  activeThreadId: string;
  isRunning: boolean;
  hasHydrated: boolean;
  setHasHydrated: (hasHydrated: boolean) => void;
  setIsRunning: (isRunning: boolean) => void;
  replaceActiveMessages: (messages: readonly ThreadMessageLike[]) => void;
  appendActiveMessage: (message: ThreadMessageLike) => void;
  replaceThreadMessages: (
    threadId: string,
    messages: readonly ThreadMessageLike[],
    historyState?: Partial<
      Pick<ChatThread, "historySource" | "historyLoaded" | "historyLoadStatus">
    >,
  ) => void;
  appendThreadMessage: (threadId: string, message: ThreadMessageLike) => void;
  linkActiveThreadToBackend: (backendThreadId: string) => void;
  linkThreadToBackend: (threadId: string, backendThreadId: string) => void;
  reconcileBackendThreads: (backendThreads: BackendThreadMetadata[]) => void;
  setThreadSyncStatus: (threadId: string, syncStatus: ThreadSyncStatus) => void;
  markThreadSynced: (threadId: string) => void;
  setThreadHistoryState: (
    threadId: string,
    historyState: Partial<
      Pick<ChatThread, "historySource" | "historyLoaded" | "historyLoadStatus">
    >,
  ) => void;
  createThread: (title?: string | null) => string;
  switchThread: (threadId: string) => void;
  renameThread: (threadId: string, title: string | null) => void;
  deleteThread: (threadId: string) => void;
  restoreThread: (thread: ChatThread, index?: number) => void;
  resetForAuthBoundary: () => void;
};

const DEFAULT_THREAD_ID = "thread-1";

const createThreadRecord = ({
  id,
  title = null,
}: {
  id: string;
  title?: string | null;
}): ChatThread => ({
  id,
  backendThreadId: null,
  title,
  messages: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  syncStatus: "local",
  lastSyncedAt: null,
  historySource: "local",
  historyLoaded: true,
  historyLoadStatus: "loaded",
});

const createDefaultThread = (): ChatThread =>
  createThreadRecord({
    id: DEFAULT_THREAD_ID,
  });

const touchThread = (
  thread: ChatThread,
  updates: Partial<Omit<ChatThread, "id" | "createdAt">>,
): ChatThread => ({
  ...thread,
  ...updates,
  updatedAt: Date.now(),
});

const nextThreadId = () => `thread-${Math.random().toString(36).slice(2, 10)}`;

export const getActiveThread = (
  state: Pick<ChatState, "threads" | "activeThreadId">,
) => state.threads[state.activeThreadId] ?? createDefaultThread();

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      threadOrder: [DEFAULT_THREAD_ID],
      threads: {
        [DEFAULT_THREAD_ID]: createDefaultThread(),
      },
      activeThreadId: DEFAULT_THREAD_ID,
      isRunning: false,
      hasHydrated: false,
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setIsRunning: (isRunning) => set({ isRunning }),
      replaceActiveMessages: (messages) =>
        set((state) => {
          const activeThread = getActiveThread(state);
          return {
            threads: {
              ...state.threads,
              [state.activeThreadId]: touchThread(activeThread, {
                messages,
              }),
            },
          };
        }),
      appendActiveMessage: (message) =>
        set((state) => {
          const activeThread = getActiveThread(state);
          return {
            threads: {
              ...state.threads,
              [state.activeThreadId]: touchThread(activeThread, {
                messages: [...activeThread.messages, message],
              }),
            },
          };
        }),
      replaceThreadMessages: (threadId, messages, historyState) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: touchThread(thread, {
                messages,
                ...historyState,
              }),
            },
          };
        }),
      appendThreadMessage: (threadId, message) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: touchThread(thread, {
                messages: [...thread.messages, message],
              }),
            },
          };
        }),
      linkActiveThreadToBackend: (backendThreadId) =>
        set((state) => {
          const activeThread = getActiveThread(state);
          return {
            threads: {
              ...state.threads,
              [state.activeThreadId]: touchThread(activeThread, {
                backendThreadId,
                syncStatus: "linked",
                lastSyncedAt: Date.now(),
                historySource: "backend",
                historyLoaded: false,
                historyLoadStatus: "idle",
              }),
            },
          };
        }),
      linkThreadToBackend: (threadId, backendThreadId) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: touchThread(thread, {
                backendThreadId,
                syncStatus: "linked",
                lastSyncedAt: Date.now(),
                historySource: "backend",
                historyLoaded: false,
                historyLoadStatus: "idle",
              }),
            },
          };
        }),
      reconcileBackendThreads: (backendThreads) =>
        set((state) => {
          const nextThreads = { ...state.threads };
          const knownBackendIds = new Map<string, string>();

          for (const [localThreadId, thread] of Object.entries(state.threads)) {
            if (thread.backendThreadId) {
              knownBackendIds.set(thread.backendThreadId, localThreadId);
            }
          }

          const appendedThreadIds: string[] = [];

          for (const backendThread of backendThreads) {
            const localThreadId = knownBackendIds.get(backendThread.thread_id);

            if (localThreadId) {
              const existingThread = nextThreads[localThreadId];
              if (!existingThread) continue;

              nextThreads[localThreadId] = {
                ...existingThread,
                backendThreadId: backendThread.thread_id,
                title: backendThread.title ?? existingThread.title,
                createdAt: backendThread.created_at ?? existingThread.createdAt,
                syncStatus: "linked",
                lastSyncedAt: Date.now(),
                historySource: "backend",
                historyLoaded: false,
                historyLoadStatus: "idle",
              };
              continue;
            }

            const newLocalThreadId = nextThreadId();
            nextThreads[newLocalThreadId] = {
              id: newLocalThreadId,
              backendThreadId: backendThread.thread_id,
              title: backendThread.title ?? null,
              messages: [],
              createdAt: backendThread.created_at ?? Date.now(),
              updatedAt: backendThread.created_at ?? Date.now(),
              syncStatus: "linked",
              lastSyncedAt: Date.now(),
              historySource: "backend",
              historyLoaded: false,
              historyLoadStatus: "idle",
            };
            appendedThreadIds.push(newLocalThreadId);
          }

          const nextThreadOrder = [
            ...state.threadOrder.filter((threadId) => threadId in nextThreads),
            ...appendedThreadIds,
          ];

          return {
            threads: nextThreads,
            threadOrder: nextThreadOrder,
          };
        }),
      setThreadSyncStatus: (threadId, syncStatus) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: touchThread(thread, { syncStatus }),
            },
          };
        }),
      markThreadSynced: (threadId) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: touchThread(thread, {
                syncStatus: thread.backendThreadId ? "linked" : "local",
                lastSyncedAt: Date.now(),
              }),
            },
          };
        }),
      setThreadHistoryState: (threadId, historyState) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: touchThread(thread, historyState),
            },
          };
        }),
      createThread: (title = null) => {
        const id = nextThreadId();
        set((state) => ({
          threadOrder: [id, ...state.threadOrder],
          threads: {
            ...state.threads,
            [id]: createThreadRecord({ id, title }),
          },
          activeThreadId: id,
        }));
        return id;
      },
      switchThread: (threadId) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;

          const nextThreads =
            thread.backendThreadId && thread.messages.length === 0
              ? {
                  ...state.threads,
                  [threadId]: {
                    ...thread,
                    historyLoaded: false,
                    historyLoadStatus: "idle" as ThreadHistoryLoadStatus,
                  },
                }
              : state.threads;

          return {
            activeThreadId: threadId,
            threads: nextThreads,
          };
        }),
      renameThread: (threadId, title) =>
        set((state) => {
          const thread = state.threads[threadId];
          if (!thread) return state;
          return {
            threads: {
              ...state.threads,
              [threadId]: touchThread(thread, {
                title,
                syncStatus: thread.backendThreadId
                  ? "syncing"
                  : thread.syncStatus,
              }),
            },
          };
        }),
      deleteThread: (threadId) =>
        set((state) => {
          if (!(threadId in state.threads)) return state;

          const nextThreads = { ...state.threads };
          delete nextThreads[threadId];

          const nextThreadOrder = state.threadOrder.filter(
            (id) => id !== threadId,
          );
          const fallbackThreadId = nextThreadOrder[0] ?? DEFAULT_THREAD_ID;

          if (nextThreadOrder.length === 0) {
            nextThreads[DEFAULT_THREAD_ID] = createDefaultThread();
            return {
              threadOrder: [DEFAULT_THREAD_ID],
              threads: nextThreads,
              activeThreadId: DEFAULT_THREAD_ID,
            };
          }

          return {
            threadOrder: nextThreadOrder,
            threads: nextThreads,
            activeThreadId:
              state.activeThreadId === threadId
                ? fallbackThreadId
                : state.activeThreadId,
          };
        }),
      restoreThread: (thread, index = 0) =>
        set((state) => {
          const nextThreadOrder = [...state.threadOrder];
          if (!nextThreadOrder.includes(thread.id)) {
            nextThreadOrder.splice(index, 0, thread.id);
          }

          return {
            threadOrder: nextThreadOrder,
            threads: {
              ...state.threads,
              [thread.id]: thread,
            },
          };
        }),
      resetForAuthBoundary: () =>
        set(() => ({
          threadOrder: [DEFAULT_THREAD_ID],
          threads: {
            [DEFAULT_THREAD_ID]: createDefaultThread(),
          },
          activeThreadId: DEFAULT_THREAD_ID,
          isRunning: false,
        })),
    }),
    {
      name: "frontend-v1-chat-store",
      version: 2,
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      migrate: (persistedState) => {
        const state = persistedState as Partial<ChatState> | undefined;
        if (!state?.threads) return persistedState as ChatState;

        const migratedThreads = Object.fromEntries(
          Object.entries(state.threads).map(([threadId, thread]) => [
            threadId,
            {
              ...thread,
              historySource: thread.backendThreadId ? "backend" : "local",
              historyLoaded: !thread.backendThreadId,
              historyLoadStatus: thread.backendThreadId ? "idle" : "loaded",
            },
          ]),
        );

        return {
          ...state,
          threads: migratedThreads,
        } as ChatState;
      },
      partialize: (state) => ({
        threadOrder: state.threadOrder,
        threads: state.threads,
        activeThreadId: state.activeThreadId,
      }),
    },
  ),
);
