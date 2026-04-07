"use client";

import {
  type AppendMessage,
  AssistantRuntimeProvider,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import { type FC, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import {
  BackendAuthError,
  type BackendThreadMessage,
  createBackendThread,
  getBackendThreadState,
  listBackendThreads,
  renameBackendThread,
  streamBackendThreadRun,
} from "@/lib/backend-threads";
import { useChatStore } from "@/lib/chat-store";

const OPENAI_COMPAT_BASE_URL =
  process.env.NEXT_PUBLIC_OPENAI_COMPAT_BASE_URL?.replace(/\/$/, "") ??
  "http://localhost:8081/v1";
const OPENAI_COMPAT_MODEL =
  process.env.NEXT_PUBLIC_OPENAI_COMPAT_MODEL ?? "agentic-rag";
const SHOW_RUN_DEBUG_PANEL = process.env.NODE_ENV !== "production";

type RunDebugEvent = {
  name: string;
  atMs: number;
  detail?: string;
};

type RunDebugState = {
  id: string;
  threadId: string;
  prompt: string;
  startedAt: number;
  events: RunDebugEvent[];
};

const convertMessage = (message: ThreadMessageLike) => {
  return message;
};

const toThreadMessage = (message: BackendThreadMessage): ThreadMessageLike => {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
  } as ThreadMessageLike;
};

const toThreadMessages = (messages: BackendThreadMessage[]) => {
  return messages.map(toThreadMessage);
};

const getTextContent = (message: ThreadMessageLike) => {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter(
      (
        part,
      ): part is Extract<(typeof message.content)[number], { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
};

const nowMs = () => performance.now();
const nextDebugId = () =>
  `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const DebugRunPanel: FC<{ debugRun: RunDebugState | null }> = ({
  debugRun,
}) => {
  if (!SHOW_RUN_DEBUG_PANEL || !debugRun) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border bg-background/95 p-3 text-xs shadow-lg">
      <div className="font-semibold">Run Debug</div>
      <div className="mt-1 text-muted-foreground">
        thread: {debugRun.threadId}
      </div>
      <div className="truncate text-muted-foreground">
        prompt: {debugRun.prompt}
      </div>
      <div className="mt-2 space-y-1">
        {debugRun.events.map((event) => (
          <div key={`${event.name}-${event.atMs}`} className="flex gap-2">
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(event.atMs)}ms
            </span>
            <span className="font-medium">{event.name}</span>
            {event.detail ? (
              <span className="text-muted-foreground">{event.detail}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

export function MyRuntimeProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const abortControllerRef = useRef<AbortController | null>(null);
  const runDebugRef = useRef<RunDebugState | null>(null);
  const activeThreadId = useChatStore((state) => state.activeThreadId);
  const activeThread = useChatStore((state) => state.threads[activeThreadId]);
  const hasHydrated = useChatStore((state) => state.hasHydrated);
  const authHasHydrated = useAuthStore((state) => state.hasHydrated);
  const authToken = useAuthStore((state) => state.token);
  const activeBackendThreadId = activeThread?.backendThreadId ?? null;
  const activeHistoryLoaded = activeThread?.historyLoaded ?? false;
  const activeMessageCount = activeThread?.messages.length ?? 0;
  const messages = activeThread?.messages ?? [];
  const isRunning = useChatStore((state) => state.isRunning);
  const setIsRunning = useChatStore((state) => state.setIsRunning);
  const appendThreadMessage = useChatStore(
    (state) => state.appendThreadMessage,
  );
  const replaceActiveMessages = useChatStore(
    (state) => state.replaceActiveMessages,
  );
  const replaceThreadMessages = useChatStore(
    (state) => state.replaceThreadMessages,
  );
  const linkThreadToBackend = useChatStore(
    (state) => state.linkThreadToBackend,
  );
  const reconcileBackendThreads = useChatStore(
    (state) => state.reconcileBackendThreads,
  );
  const setThreadSyncStatus = useChatStore(
    (state) => state.setThreadSyncStatus,
  );
  const markThreadSynced = useChatStore((state) => state.markThreadSynced);
  const setThreadHistoryState = useChatStore(
    (state) => state.setThreadHistoryState,
  );
  const [debugRun, setDebugRun] = useState<RunDebugState | null>(null);
  const shouldLoadBackendHistory =
    !!activeBackendThreadId &&
    (!activeHistoryLoaded || activeMessageCount === 0);

  const recordRunEvent = (name: string, detail?: string) => {
    const current = runDebugRef.current;
    if (!current) return;
    const next = {
      ...current,
      events: [
        ...current.events,
        {
          name,
          atMs: nowMs() - current.startedAt,
          detail,
        },
      ],
    };
    runDebugRef.current = next;
    setDebugRun(next);
    console.info("[run-debug]", name, detail ?? "");
    void fetch("/api/debug-run-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        runId: next.id,
        threadId: next.threadId,
        prompt: next.prompt,
        name,
        detail: detail ?? null,
        atMs: next.events[next.events.length - 1]?.atMs ?? null,
        createdAt: new Date().toISOString(),
      }),
      keepalive: true,
    }).catch(() => {
      // Best-effort local debugging only.
    });
  };

  useEffect(() => {
    if (!hasHydrated || !authHasHydrated || !authToken) {
      return;
    }

    let cancelled = false;

    void listBackendThreads()
      .then((backendThreads) => {
        if (cancelled) return;
        reconcileBackendThreads(backendThreads);
      })
      .catch((error) => {
        if (error instanceof BackendAuthError) return;
        console.warn("Failed to hydrate backend thread metadata", error);
      });

    return () => {
      cancelled = true;
    };
  }, [authHasHydrated, authToken, hasHydrated, reconcileBackendThreads]);

  useEffect(() => {
    if (!authHasHydrated || authToken) {
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsRunning(false);
  }, [authHasHydrated, authToken, setIsRunning]);

  useEffect(() => {
    if (!SHOW_RUN_DEBUG_PANEL) return;
    if (isRunning) return;
    if (!runDebugRef.current) return;
    recordRunEvent("idle_restored");
  }, [isRunning, recordRunEvent]);

  useEffect(() => {
    if (
      !hasHydrated ||
      !authHasHydrated ||
      !authToken ||
      !activeBackendThreadId ||
      !shouldLoadBackendHistory
    ) {
      return;
    }

    let cancelled = false;
    recordRunEvent("state_fetch_started", activeBackendThreadId);
    setThreadHistoryState(activeThreadId, {
      historySource: "backend",
      historyLoadStatus: "loading",
    });

    void getBackendThreadState(activeBackendThreadId)
      .then((state) => {
        if (cancelled) return;
        recordRunEvent(
          "state_fetch_completed",
          `${state.messages.length} messages`,
        );
        replaceThreadMessages(
          activeThreadId,
          toThreadMessages(state.messages),
          {
            historySource: "backend",
            historyLoaded: true,
            historyLoadStatus: "loaded",
          },
        );
      })
      .catch((error) => {
        if (cancelled) return;
        recordRunEvent(
          "state_fetch_failed",
          error instanceof Error ? error.message : "unknown error",
        );
        setThreadHistoryState(activeThreadId, {
          historySource: "backend",
          historyLoaded: false,
          historyLoadStatus:
            error instanceof BackendAuthError ? "idle" : "error",
        });
        if (error instanceof BackendAuthError) return;
        console.warn("Failed to load backend thread state", error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeThreadId,
    activeBackendThreadId,
    authHasHydrated,
    authToken,
    hasHydrated,
    replaceThreadMessages,
    setThreadHistoryState,
    shouldLoadBackendHistory,
    recordRunEvent,
  ]);

  const onNew = async (message: AppendMessage) => {
    if (message.content.length !== 1 || message.content[0]?.type !== "text")
      throw new Error("Only text content is supported");

    const threadId = activeThreadId;
    const userMessage: ThreadMessageLike = {
      role: "user",
      content: [{ type: "text", text: message.content[0].text }],
    };
    const localTitle = activeThread?.title ?? null;
    const baseMessages = [...messages, userMessage];
    replaceThreadMessages(threadId, baseMessages);
    setIsRunning(true);
    abortControllerRef.current = new AbortController();
    const startedAt = nowMs();
    const nextDebugRun: RunDebugState = {
      id: nextDebugId(),
      threadId,
      prompt: message.content[0].text,
      startedAt,
      events: [
        {
          name: "send_clicked",
          atMs: 0,
        },
      ],
    };
    runDebugRef.current = nextDebugRun;
    setDebugRun(nextDebugRun);
    let backendThreadId = activeBackendThreadId;
    let backendLinkSucceeded = false;
    let backendRunSucceeded = false;

    try {
      if (!backendThreadId && authToken) {
        setThreadSyncStatus(threadId, "syncing");
        recordRunEvent("thread_create_started");
        try {
          const backendThread = await createBackendThread();
          backendThreadId = backendThread.thread_id;
          recordRunEvent("thread_create_completed", backendThread.thread_id);
          linkThreadToBackend(threadId, backendThread.thread_id);
          if (localTitle) {
            recordRunEvent("thread_rename_started", localTitle);
            await renameBackendThread(backendThread.thread_id, localTitle);
            recordRunEvent("thread_rename_completed", localTitle);
          }
          backendLinkSucceeded = true;
        } catch (error) {
          if (error instanceof BackendAuthError) {
            setThreadSyncStatus(threadId, "local");
          } else {
            setThreadSyncStatus(threadId, "error");
          }
          console.warn("Failed to link thread to backend", error);
        }
      }

      if (backendThreadId) {
        setThreadHistoryState(threadId, {
          historySource: "backend",
          historyLoadStatus: "loading",
        });
        recordRunEvent("run_stream_started", backendThreadId);
        let sawFirstPartial = false;
        let sawFirstVisibleText = false;

        for await (const event of streamBackendThreadRun(
          backendThreadId,
          message.content[0].text,
          abortControllerRef.current.signal,
        )) {
          if (
            event.type === "messages/partial" ||
            event.type === "messages/complete"
          ) {
            if (!sawFirstPartial) {
              sawFirstPartial = true;
              recordRunEvent("first_partial_received", event.type);
            }
            const nextMessages = [
              ...baseMessages,
              toThreadMessage(event.message),
            ];
            replaceThreadMessages(
              threadId,
              [...baseMessages, toThreadMessage(event.message)],
              {
                historySource: "backend",
                historyLoaded: true,
                historyLoadStatus: "loaded",
              },
            );
            const lastMsg = nextMessages[nextMessages.length - 1];
            if (
              !sawFirstVisibleText &&
              lastMsg &&
              getTextContent(lastMsg).trim()
            ) {
              sawFirstVisibleText = true;
              recordRunEvent("first_assistant_text_committed");
            }
            continue;
          }

          if (event.type === "values") {
            recordRunEvent(
              "values_received",
              `${event.state.messages.length} messages`,
            );
            replaceThreadMessages(
              threadId,
              toThreadMessages(event.state.messages),
              {
                historySource: "backend",
                historyLoaded: true,
                historyLoadStatus: "loaded",
              },
            );
            backendRunSucceeded = true;
            continue;
          }

          if (event.type === "error") {
            recordRunEvent("stream_error", event.message);
            setThreadSyncStatus(threadId, "error");
            setThreadHistoryState(threadId, {
              historySource: "backend",
              historyLoadStatus: "error",
            });
            throw new Error(event.message);
          }
        }
      } else {
        recordRunEvent("compat_completion_started");
        const response = await fetch(
          `${OPENAI_COMPAT_BASE_URL}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: OPENAI_COMPAT_MODEL,
              stream: true,
              messages: baseMessages.map((item) => ({
                role: item.role,
                content: getTextContent(item),
              })),
            }),
            signal: abortControllerRef.current.signal,
          },
        );

        if (!response.ok) {
          throw new Error(await response.text());
        }

        if (!response.body) {
          throw new Error("The backend did not return a readable stream.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const event of events) {
            const dataLines = event
              .split("\n")
              .filter((line) => line.startsWith("data: "))
              .map((line) => line.slice(6).trim());

            for (const payload of dataLines) {
              if (!payload || payload === "[DONE]") continue;

              const chunk = JSON.parse(payload) as {
                choices?: Array<{
                  delta?: {
                    content?: string | null;
                  };
                }>;
              };

              const delta = chunk.choices?.[0]?.delta?.content;
              if (!delta) continue;

              assistantText += delta;
              if (assistantText === delta) {
                recordRunEvent("first_partial_received", "compat");
              }
              replaceThreadMessages(threadId, [
                ...baseMessages,
                {
                  role: "assistant",
                  content: [{ type: "text", text: assistantText }],
                } as ThreadMessageLike,
              ]);
              if (assistantText.trim() === delta.trim()) {
                recordRunEvent("first_assistant_text_committed");
              }
            }
          }
        }

        if (!assistantText) {
          appendThreadMessage(threadId, {
            role: "assistant",
            content: [
              { type: "text", text: "The backend returned an empty response." },
            ],
          });
        }
      }

      if (backendThreadId && (backendRunSucceeded || backendLinkSucceeded)) {
        markThreadSynced(threadId);
        recordRunEvent("thread_marked_linked");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        if (error instanceof BackendAuthError && backendThreadId) {
          setThreadSyncStatus(threadId, "error");
        }
        if (backendThreadId) {
          setThreadHistoryState(threadId, {
            historySource: "backend",
            historyLoadStatus: "error",
          });
        }
        recordRunEvent(
          "run_failed",
          error instanceof Error ? error.message : "unknown error",
        );
        throw error;
      }
    } finally {
      abortControllerRef.current = null;
      setIsRunning(false);
    }
  };

  const onCancel = async () => {
    abortControllerRef.current?.abort();
  };

  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    isRunning,
    messages,
    setMessages: replaceActiveMessages,
    onNew,
    onCancel,
    convertMessage,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
      <DebugRunPanel debugRun={debugRun} />
    </AssistantRuntimeProvider>
  );
}
