"use client";

import { useAui, useAuiState } from "@assistant-ui/store";
import { ArrowUpRightIcon, SparklesIcon } from "lucide-react";
import { type FC, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useFollowupSuggestions } from "@/lib/followupSuggestions";

/**
 * Follow-up suggestions rendered in a "stacked" style (mirrors the
 * tool-ui CitationList stacked variant shape): a compact trigger chip
 * showing the count, with the actual prompts tucked into a popover
 * where each line is a clickable item. Keeps the message footprint
 * small regardless of how many follow-ups come back.
 */
export const FollowupSuggestions: FC = () => {
  const aui = useAui();
  const [open, setOpen] = useState(false);
  const threadId = useAuiState(
    (s) => s.threadListItem.externalId ?? s.threadListItem.remoteId,
  );
  const suggestions = useFollowupSuggestions(threadId);

  if (!threadId || suggestions.length === 0) return null;

  const pick = (text: string) => {
    if (aui.thread().getState().isRunning) return;
    const composer = aui.composer();
    aui.thread().append({
      content: [{ type: "text", text }],
      runConfig: composer.getState().runConfig,
    });
    setOpen(false);
  };

  return (
    <div className="mt-4 inline-flex">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/40 px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <SparklesIcon className="size-3.5" />
            <span>建議延伸問題</span>
            <span className="tabular-nums text-xs">{suggestions.length}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className="w-80 p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex max-h-72 flex-col overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => pick(s.text)}
                className="group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="flex-1 text-pretty leading-snug">
                  {s.text}
                </span>
                <ArrowUpRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
