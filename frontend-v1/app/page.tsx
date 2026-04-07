"use client";

import { AuiProvider, Suggestions, useAui } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { ThreadListSidebar } from "@/components/assistant-ui/thread-list-sidebar";

function ThreadWithSuggestions() {
  const aui = useAui({
    suggestions: Suggestions([
      {
        title: "Send a test message",
        label: "to see the external store in action",
        prompt: "Hello! How does the external store work?",
      },
      {
        title: "Tell me a story",
        label: "to generate multiple messages",
        prompt: "Tell me a short story about a robot learning to paint.",
      },
    ]),
  });
  return (
    <AuiProvider value={aui}>
      <Thread />
    </AuiProvider>
  );
}

export default function Home() {
  return (
    <main className="flex h-dvh">
      <ThreadListSidebar />
      <div className="min-w-0 flex-1">
        <ThreadWithSuggestions />
      </div>
    </main>
  );
}
