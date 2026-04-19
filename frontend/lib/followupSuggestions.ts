"use client";

import { useSyncExternalStore } from "react";

export type FollowupSuggestion = {
  id: string;
  text: string;
};

type SuggestionMap = Map<string, FollowupSuggestion[]>;

const EMPTY_SUGGESTIONS: FollowupSuggestion[] = [];

let suggestionsByThread: SuggestionMap = new Map();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const setFollowupSuggestions = (
  threadId: string,
  suggestions: FollowupSuggestion[],
) => {
  suggestionsByThread = new Map(suggestionsByThread);
  if (suggestions.length === 0) {
    suggestionsByThread.delete(threadId);
  } else {
    suggestionsByThread.set(threadId, suggestions);
  }
  emit();
};

export const clearFollowupSuggestions = (threadId: string) => {
  if (!suggestionsByThread.has(threadId)) return;
  suggestionsByThread = new Map(suggestionsByThread);
  suggestionsByThread.delete(threadId);
  emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useFollowupSuggestions = (threadId: string | null | undefined) => {
  return useSyncExternalStore(
    subscribe,
    () =>
      threadId
        ? (suggestionsByThread.get(threadId) ?? EMPTY_SUGGESTIONS)
        : EMPTY_SUGGESTIONS,
    () => EMPTY_SUGGESTIONS,
  );
};

// Test-only accessors. The React hook is the intended production read path;
// these let unit tests inspect the store without a render harness.
export const __getFollowupSuggestionsForTest = (threadId: string) =>
  suggestionsByThread.get(threadId);

export const __subscribeForTest = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
