"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useLangGraphRuntime } from "@assistant-ui/react-langgraph";
import { useAui } from "@assistant-ui/store";
import { SearchIcon, XIcon } from "lucide-react";
import { createContext, type FC, useContext, useEffect, useState } from "react";
import type { DeepDiveTarget } from "@/components/assistant-ui/deep-dive-provider";
import { Thread } from "@/components/assistant-ui/thread";
import { Button } from "@/components/ui/button";
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
 * Populated inside the Deep Dive overlay with the fetched source record
 * so nested components (specifically the deep-dive Thread's welcome)
 * can render source-aware starter prompts. `null` means "not in a deep
 * dive" or "source still loading".
 */
export const DeepDiveSourceContext = createContext<SourceRecord | null>(null);

/** Hook used by `ThreadWelcome` to decide between default and deep-dive starters. */
export const useDeepDiveSource = (): SourceRecord | null =>
  useContext(DeepDiveSourceContext);

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
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; record: SourceRecord }
  >({ status: "loading" });

  // Fetch the record at the overlay level so both panes — source
  // viewer on the left AND the Thread's deep-dive welcome on the right
  // (via DeepDiveSourceContext) — share a single fetch.
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sourceRecord = state.status === "ready" ? state.record : null;

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
            {sourceRecord?.title ?? `${target.sourceType} · ${target.recordId}`}
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
        <DeepDiveSourceContext.Provider value={sourceRecord}>
          <AssistantRuntimeProvider runtime={runtime}>
            <ResizablePanelGroup orientation="horizontal">
              <ResizablePanel defaultSize={55} minSize={30}>
                <SourceContentView state={state} />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize={45} minSize={30}>
                <Thread />
              </ResizablePanel>
            </ResizablePanelGroup>
          </AssistantRuntimeProvider>
        </DeepDiveSourceContext.Provider>
      </div>
    </div>
  );
};

type SourceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; record: SourceRecord };

const SourceContentView: FC<{ state: SourceState }> = ({ state }) => {
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
 * Source-aware starter prompts rendered in place of the main chat's
 * global StarterSuggestions when the Thread is inside a Deep Dive.
 *
 * Uses the fetched record (via DeepDiveSourceContext) so prompts
 * reference the actual source the user pinned. Falls back to generic
 * prompts if the record hasn't loaded yet — the user may start typing
 * while the source fetch is in flight.
 */
export const DeepDiveStarters: FC<{ variant?: "start" | "followup" }> = ({
  variant = "start",
}) => {
  const source = useDeepDiveSource();
  const aui = useAui();

  const prompts = buildDeepDivePrompts(source);
  const heading = variant === "start" ? "從這些問題開始:" : "繼續探索:";

  return (
    <div className="w-full">
      <div className="mb-3 px-1 text-muted-foreground text-sm">{heading}</div>
      <div className="grid w-full gap-2 pb-4 @md:grid-cols-2">
        {prompts.map((prompt) => (
          <Button
            key={prompt.id}
            variant="ghost"
            type="button"
            className="h-auto w-full flex-col items-start gap-1 rounded-3xl border border-border/70 bg-background/90 px-4 py-4 text-left text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-muted/40"
            onClick={() => {
              if (aui.thread().getState().isRunning) return;
              const composer = aui.composer();
              aui.thread().append({
                content: [{ type: "text", text: prompt.text }],
                runConfig: composer.getState().runConfig,
              });
            }}
          >
            <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <SearchIcon className="size-3" />
              {prompt.label}
            </span>
            <span className="text-pretty font-medium text-foreground leading-6">
              {prompt.text}
            </span>
          </Button>
        ))}
      </div>
    </div>
  );
};

type DeepDivePrompt = { id: string; label: string; text: string };

const buildDeepDivePrompts = (
  source: SourceRecord | null,
): DeepDivePrompt[] => {
  // Prefer the most specific available handle for natural prose.
  const handle =
    source?.chapter_title || source?.title || source?.book_title || "這份來源";
  return [
    {
      id: "summarize",
      label: "總結",
      text: `請總結「${handle}」的內容。`,
    },
    {
      id: "main-points",
      label: "重點",
      text: `「${handle}」的主要重點是什麼?`,
    },
    {
      id: "critical",
      label: "關鍵句子",
      text: `請列出「${handle}」中最重要的句子。`,
    },
    {
      id: "explain",
      label: "深入淺出",
      text: `請以更淺顯的方式解釋「${handle}」的核心概念。`,
    },
  ];
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
