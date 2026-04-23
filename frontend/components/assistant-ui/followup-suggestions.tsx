"use client";

import { useAui, useAuiState } from "@assistant-ui/store";
import { ArrowUpRightIcon, SparklesIcon } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import { useFollowupSuggestions } from "@/lib/followupSuggestions";

export const FollowupSuggestions: FC = () => {
  const aui = useAui();
  const threadId = useAuiState(
    (s) => s.threadListItem.externalId ?? s.threadListItem.remoteId,
  );
  const suggestions = useFollowupSuggestions(threadId);

  if (!threadId || suggestions.length === 0) return null;

  return (
    <div className="mt-4 rounded-3xl border border-border/70 bg-muted/25 p-4">
      <div className="mb-3 flex items-center gap-2 text-muted-foreground text-sm">
        <SparklesIcon className="size-4" />
        建議延伸問題
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.id}
            type="button"
            variant="outline"
            className="h-auto w-full items-start justify-between gap-2 rounded-2xl px-3 py-2 text-left text-sm"
            onClick={() => {
              if (aui.thread().getState().isRunning) return;
              const composer = aui.composer();
              aui.thread().append({
                content: [{ type: "text", text: suggestion.text }],
                runConfig: composer.getState().runConfig,
              });
            }}
          >
            <span className="text-pretty leading-snug">{suggestion.text}</span>
            <ArrowUpRightIcon className="size-3.5 shrink-0 translate-y-0.5" />
          </Button>
        ))}
      </div>
    </div>
  );
};
