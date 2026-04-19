"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { XIcon } from "lucide-react";
import { type FC, useEffect, useState } from "react";
import type { DeepDiveTarget } from "@/components/assistant-ui/deep-dive-provider";
import { Thread } from "@/components/assistant-ui/thread";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { createThread, getThreadState, sendMessage } from "@/lib/chatApi";
import { fetchSourceRecord, type SourceRecord } from "@/lib/sources";

type OverlayProps = {
  target: DeepDiveTarget;
  onClose: () => void;
};

/**
 * Fullscreen Deep Dive workspace:
 * - Left pane: full source record (all chunks in order).
 * - Right pane: a fresh Thread with its own LangGraph runtime bound to
 *   a new deep-dive thread. Every run sends `scope_record_id` +
 *   `scope_source_type` metadata so retrieval stays pinned to this
 *   record.
 *
 * Rendered via a React portal from `DeepDiveProvider`, so it sits at
 * the root of the DOM and covers the main chat UI without being
 * inside the main assistant runtime's tree.
 */
export const DeepDiveOverlay: FC<OverlayProps> = ({ target, onClose }) => {
  const runtime = useDeepDiveRuntime(target);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Deep dive"
    >
      <header className="flex items-center justify-between border-b px-4 py-2">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-[0.12em]">
            Deep Dive
          </div>
          <div className="truncate text-sm font-medium">
            {target.sourceType} · {target.recordId}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label="Close deep dive"
        >
          <XIcon className="size-4" />
        </button>
      </header>
      <div className="flex-1 min-h-0">
        <AssistantRuntimeProvider runtime={runtime}>
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize={55} minSize={30}>
              <SourceContentView target={target} />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize={45} minSize={30}>
              <Thread />
            </ResizablePanel>
          </ResizablePanelGroup>
        </AssistantRuntimeProvider>
      </div>
    </div>
  );
};

const SourceContentView: FC<{ target: DeepDiveTarget }> = ({ target }) => {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; record: SourceRecord }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchSourceRecord(target.sourceType, target.recordId)
      .then((record) => {
        if (!cancelled) setState({ status: "ready", record });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [target.recordId, target.sourceType]);

  if (state.status === "loading") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-muted-foreground text-sm">
        Loading source…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex h-full items-center justify-center p-6 text-destructive text-sm">
        {state.message}
      </div>
    );
  }

  const { record } = state;
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-5 py-4">
        {record.book_title ? (
          <div className="mb-1 text-muted-foreground text-xs uppercase tracking-[0.12em]">
            {record.book_title}
          </div>
        ) : null}
        <h2 className="text-foreground text-base font-semibold leading-snug">
          {record.title}
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
          {record.chapter_title ? <span>{record.chapter_title}</span> : null}
          {record.attribution ? <span>— {record.attribution}</span> : null}
          {record.publish_date ? <span>· {record.publish_date}</span> : null}
          {record.source_url ? (
            <a
              href={record.source_url}
              target="_blank"
              rel="noreferrer"
              className="ml-auto underline hover:text-foreground"
            >
              Open source ↗
            </a>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 text-sm leading-relaxed whitespace-pre-wrap">
        {record.chunks.map((chunk) => (
          <p key={chunk.chunk_id} className="mb-4 last:mb-0">
            {chunk.text}
          </p>
        ))}
      </div>
    </div>
  );
};

/**
 * Independent runtime for the deep-dive chat. Creates a new thread on
 * first send (lazy via `initialize()`), tagged with deep-dive metadata
 * so it's hidden from the main thread list. Streams carry
 * scope_record_id + scope_source_type so the backend retrieve node
 * pulls only this record's chunks.
 */
const useDeepDiveRuntime = (target: DeepDiveTarget) => {
  return useLangGraphRuntime({
    stream: async function* (messages, { initialize, command }) {
      const { externalId } = await initialize();
      if (!externalId) throw new Error("Deep dive thread missing");
      yield* sendMessage({
        threadId: externalId,
        messages,
        command,
        metadata: {
          scope_record_id: target.recordId,
          scope_source_type: target.sourceType,
        },
      });
    },
    create: async () => {
      const { thread_id } = await createThread({
        deep_dive: true,
        parent_thread_id: target.parentThreadId ?? null,
        source: {
          record_id: target.recordId,
          source_type: target.sourceType,
        },
      });
      return { externalId: thread_id };
    },
    load: async (externalId) => {
      const state = await getThreadState(externalId);
      return { messages: state.messages };
    },
  });
};
