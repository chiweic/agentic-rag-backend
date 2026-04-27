"use client";

import { Menu } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Message,
  type Thread,
  createThread,
  generateTitle,
  getThreadState,
  listThreads,
  sendStream,
} from "@/lib/api";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ThreadDrawer } from "../threads/ThreadDrawer";

export function Chat({ userName }: { userName: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const initialized = useRef(false);

  const refreshThreads = useCallback(async () => {
    try {
      const list = await listThreads();
      setThreads(list);
      return list;
    } catch (e) {
      console.error("listThreads failed", e);
      return [];
    }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setCurrentId(id);
    setMessages([]);
    try {
      const { messages } = await getThreadState(id);
      setMessages(messages);
    } catch (e) {
      console.error("getThreadState failed", e);
    }
  }, []);

  const newThread = useCallback(async () => {
    try {
      const t = await createThread();
      await refreshThreads();
      await loadThread(t.thread_id);
    } catch (e) {
      console.error("createThread failed", e);
    }
  }, [refreshThreads, loadThread]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    (async () => {
      const list = await refreshThreads();
      if (list.length > 0) {
        await loadThread(list[0].thread_id);
      } else {
        await newThread();
      }
    })();
  }, [refreshThreads, loadThread, newThread]);

  const handleSend = async (text: string) => {
    if (!currentId) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
      citations: [],
    };
    const isFirstTurn = messages.length === 0;
    const assistantPlaceholder: Message = {
      id: `a-${Date.now()}`,
      role: "assistant",
      text: "",
      citations: [],
    };
    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setPending(true);
    try {
      let finalMessages: Message[] | null = null;
      for await (const update of sendStream({ threadId: currentId, text })) {
        if (update.kind === "partial" || update.kind === "complete") {
          setMessages((prev) => {
            const next = [...prev];
            const lastIdx = next.length - 1;
            if (lastIdx >= 0 && next[lastIdx].role === "assistant") {
              next[lastIdx] = { ...next[lastIdx], text: update.message.text };
            }
            return next;
          });
        } else if (update.kind === "values") {
          finalMessages = update.messages;
        }
      }
      if (finalMessages && finalMessages.length > 0) {
        setMessages(finalMessages);
      }
      if (isFirstTurn) {
        try {
          await generateTitle(currentId);
          await refreshThreads();
        } catch {
          // title generation is best-effort
        }
      }
    } catch (e) {
      console.error("sendStream failed", e);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open drawer"
          className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-100"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="truncate text-sm font-medium text-zinc-900">
          {threads.find((t) => t.thread_id === currentId)?.title?.trim() ||
            "New thread"}
        </span>
      </header>

      <MessageList messages={messages} />

      <Composer onSend={handleSend} disabled={pending || !currentId} />

      <ThreadDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        threads={threads}
        currentId={currentId}
        onSelect={loadThread}
        onNew={newThread}
        userName={userName}
      />
    </div>
  );
}
