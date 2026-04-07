import { beforeEach, describe, expect, it } from "vitest";
import type { BackendThreadMetadata } from "@/lib/chat-store";
import { useChatStore } from "@/lib/chat-store";

// Reset store state before each test
beforeEach(() => {
  useChatStore.setState(useChatStore.getInitialState());
});

describe("createThread", () => {
  it("creates a new thread and makes it active", () => {
    const id = useChatStore.getState().createThread("Test Thread");
    const state = useChatStore.getState();

    expect(state.activeThreadId).toBe(id);
    expect(state.threads[id]).toBeDefined();
    expect(state.threads[id]?.title).toBe("Test Thread");
    expect(state.threads[id]?.syncStatus).toBe("local");
    expect(state.threads[id]?.messages).toEqual([]);
  });

  it("prepends new thread to threadOrder", () => {
    const id = useChatStore.getState().createThread();
    const state = useChatStore.getState();

    expect(state.threadOrder[0]).toBe(id);
  });

  it("creates thread with null title by default", () => {
    const id = useChatStore.getState().createThread();
    expect(useChatStore.getState().threads[id]?.title).toBeNull();
  });
});

describe("linkThreadToBackend", () => {
  it("sets backendThreadId and status to linked", () => {
    const id = useChatStore.getState().createThread();
    useChatStore.getState().linkThreadToBackend(id, "backend-123");

    const thread = useChatStore.getState().threads[id]!;
    expect(thread.backendThreadId).toBe("backend-123");
    expect(thread.syncStatus).toBe("linked");
    expect(thread.historySource).toBe("backend");
    expect(thread.historyLoaded).toBe(false);
    expect(thread.historyLoadStatus).toBe("idle");
  });

  it("no-ops for nonexistent thread", () => {
    const before = useChatStore.getState();
    useChatStore.getState().linkThreadToBackend("nonexistent", "backend-123");
    const after = useChatStore.getState();

    expect(after.threads).toEqual(before.threads);
  });
});

describe("linkActiveThreadToBackend", () => {
  it("links the currently active thread", () => {
    const id = useChatStore.getState().createThread();
    useChatStore.getState().linkActiveThreadToBackend("backend-456");

    const thread = useChatStore.getState().threads[id]!;
    expect(thread.backendThreadId).toBe("backend-456");
    expect(thread.syncStatus).toBe("linked");
  });
});

describe("reconcileBackendThreads", () => {
  it("adds new backend-only threads", () => {
    const backendThreads: BackendThreadMetadata[] = [
      { thread_id: "bt-1", title: "Backend Thread 1", created_at: 1000 },
      { thread_id: "bt-2", title: "Backend Thread 2", created_at: 2000 },
    ];

    useChatStore.getState().reconcileBackendThreads(backendThreads);
    const state = useChatStore.getState();

    const linkedThreads = Object.values(state.threads).filter(
      (t) => t.backendThreadId !== null,
    );
    expect(linkedThreads).toHaveLength(2);
    expect(linkedThreads.map((t) => t.backendThreadId).sort()).toEqual([
      "bt-1",
      "bt-2",
    ]);
  });

  it("updates existing linked threads without duplicating", () => {
    const id = useChatStore.getState().createThread("Old Title");
    useChatStore.getState().linkThreadToBackend(id, "bt-existing");

    useChatStore
      .getState()
      .reconcileBackendThreads([
        { thread_id: "bt-existing", title: "New Title", created_at: 5000 },
      ]);

    const state = useChatStore.getState();
    const linkedThreads = Object.values(state.threads).filter(
      (t) => t.backendThreadId === "bt-existing",
    );
    expect(linkedThreads).toHaveLength(1);
    expect(linkedThreads[0]?.title).toBe("New Title");
  });

  it("preserves local-only threads", () => {
    useChatStore.getState().createThread("Local Thread");

    useChatStore
      .getState()
      .reconcileBackendThreads([{ thread_id: "bt-new", title: "Backend" }]);

    const state = useChatStore.getState();
    const localThreads = Object.values(state.threads).filter(
      (t) => t.backendThreadId === null,
    );
    // Default thread + the one we created
    expect(localThreads.length).toBeGreaterThanOrEqual(2);
  });
});

describe("renameThread", () => {
  it("updates thread title", () => {
    const id = useChatStore.getState().createThread("Original");
    useChatStore.getState().renameThread(id, "Renamed");

    expect(useChatStore.getState().threads[id]?.title).toBe("Renamed");
  });

  it("sets syncStatus to syncing for linked threads", () => {
    const id = useChatStore.getState().createThread("Original");
    useChatStore.getState().linkThreadToBackend(id, "bt-1");
    useChatStore.getState().renameThread(id, "Renamed");

    expect(useChatStore.getState().threads[id]?.syncStatus).toBe("syncing");
  });

  it("preserves syncStatus for local threads", () => {
    const id = useChatStore.getState().createThread("Local");
    useChatStore.getState().renameThread(id, "Renamed Local");

    expect(useChatStore.getState().threads[id]?.syncStatus).toBe("local");
  });
});

describe("deleteThread", () => {
  it("removes thread from threads and threadOrder", () => {
    const id = useChatStore.getState().createThread("To Delete");
    useChatStore.getState().deleteThread(id);

    const state = useChatStore.getState();
    expect(state.threads[id]).toBeUndefined();
    expect(state.threadOrder).not.toContain(id);
  });

  it("falls back to next thread when deleting active thread", () => {
    const id1 = useChatStore.getState().createThread("Thread 1");
    const id2 = useChatStore.getState().createThread("Thread 2");

    // id2 is now active (most recently created)
    expect(useChatStore.getState().activeThreadId).toBe(id2);
    useChatStore.getState().deleteThread(id2);

    expect(useChatStore.getState().activeThreadId).toBe(id1);
  });

  it("creates default thread when last thread is deleted", () => {
    const state = useChatStore.getState();
    // Delete all threads
    for (const id of state.threadOrder) {
      useChatStore.getState().deleteThread(id);
    }

    const afterState = useChatStore.getState();
    expect(afterState.threadOrder).toHaveLength(1);
    expect(afterState.threadOrder[0]).toBe("thread-1");
    expect(afterState.threads["thread-1"]).toBeDefined();
  });
});

describe("restoreThread", () => {
  it("restores a deleted thread at the specified index", () => {
    const id1 = useChatStore.getState().createThread("Thread 1");
    const _id2 = useChatStore.getState().createThread("Thread 2");

    const thread1 = useChatStore.getState().threads[id1]!;
    useChatStore.getState().deleteThread(id1);

    expect(useChatStore.getState().threads[id1]).toBeUndefined();

    // Restore at index 1 (after id2)
    useChatStore.getState().restoreThread(thread1, 1);

    const state = useChatStore.getState();
    expect(state.threads[id1]).toBeDefined();
    expect(state.threadOrder.indexOf(id1)).toBe(1);
  });
});

describe("setThreadSyncStatus", () => {
  it("transitions sync status", () => {
    const id = useChatStore.getState().createThread();
    useChatStore.getState().setThreadSyncStatus(id, "syncing");
    expect(useChatStore.getState().threads[id]?.syncStatus).toBe("syncing");

    useChatStore.getState().setThreadSyncStatus(id, "error");
    expect(useChatStore.getState().threads[id]?.syncStatus).toBe("error");

    useChatStore.getState().setThreadSyncStatus(id, "linked");
    expect(useChatStore.getState().threads[id]?.syncStatus).toBe("linked");
  });
});

describe("markThreadSynced", () => {
  it("sets linked status for backend threads", () => {
    const id = useChatStore.getState().createThread();
    useChatStore.getState().linkThreadToBackend(id, "bt-1");
    useChatStore.getState().setThreadSyncStatus(id, "syncing");
    useChatStore.getState().markThreadSynced(id);

    const thread = useChatStore.getState().threads[id]!;
    expect(thread.syncStatus).toBe("linked");
    expect(thread.lastSyncedAt).not.toBeNull();
  });

  it("sets local status for non-backend threads", () => {
    const id = useChatStore.getState().createThread();
    useChatStore.getState().markThreadSynced(id);

    expect(useChatStore.getState().threads[id]?.syncStatus).toBe("local");
  });
});

describe("messages", () => {
  it("replaceActiveMessages replaces messages on active thread", () => {
    const id = useChatStore.getState().createThread();
    const messages = [
      {
        role: "user" as const,
        content: [{ type: "text" as const, text: "hello" }],
      },
    ];

    useChatStore.getState().replaceActiveMessages(messages);
    expect(useChatStore.getState().threads[id]?.messages).toEqual(messages);
  });

  it("appendActiveMessage adds to active thread", () => {
    const id = useChatStore.getState().createThread();
    const msg1 = {
      role: "user" as const,
      content: [{ type: "text" as const, text: "hello" }],
    };
    const msg2 = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text: "hi" }],
    };

    useChatStore.getState().appendActiveMessage(msg1);
    useChatStore.getState().appendActiveMessage(msg2);

    expect(useChatStore.getState().threads[id]?.messages).toHaveLength(2);
  });
});

describe("resetForAuthBoundary", () => {
  it("clears all threads and resets to default", () => {
    useChatStore.getState().createThread("Thread A");
    useChatStore.getState().createThread("Thread B");

    useChatStore.getState().resetForAuthBoundary();

    const state = useChatStore.getState();
    expect(state.threadOrder).toEqual(["thread-1"]);
    expect(Object.keys(state.threads)).toEqual(["thread-1"]);
    expect(state.activeThreadId).toBe("thread-1");
    expect(state.isRunning).toBe(false);
  });
});

describe("switchThread", () => {
  it("switches active thread", () => {
    const id1 = useChatStore.getState().createThread("Thread 1");
    const id2 = useChatStore.getState().createThread("Thread 2");

    expect(useChatStore.getState().activeThreadId).toBe(id2);
    useChatStore.getState().switchThread(id1);
    expect(useChatStore.getState().activeThreadId).toBe(id1);
  });

  it("no-ops for nonexistent thread", () => {
    const before = useChatStore.getState().activeThreadId;
    useChatStore.getState().switchThread("nonexistent");
    expect(useChatStore.getState().activeThreadId).toBe(before);
  });

  it("resets history state for empty backend thread on switch", () => {
    const id = useChatStore.getState().createThread();
    useChatStore.getState().linkThreadToBackend(id, "bt-1");
    // Mark as loaded first
    useChatStore.getState().setThreadHistoryState(id, {
      historyLoaded: true,
      historyLoadStatus: "loaded",
    });

    // Switch away and back — empty backend thread should reset to idle
    const _otherId = useChatStore.getState().createThread();
    useChatStore.getState().switchThread(id);

    const thread = useChatStore.getState().threads[id]!;
    expect(thread.historyLoaded).toBe(false);
    expect(thread.historyLoadStatus).toBe("idle");
  });
});
