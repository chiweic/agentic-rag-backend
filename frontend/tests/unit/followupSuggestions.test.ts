import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearFollowupSuggestions,
  type FollowupSuggestion,
  __getFollowupSuggestionsForTest as getForTest,
  setFollowupSuggestions,
  __subscribeForTest as subscribeForTest,
} from "@/lib/followupSuggestions";

const THREAD_A = "thread-a";
const THREAD_B = "thread-b";

const SUGGESTIONS: FollowupSuggestion[] = [
  { id: "s1", text: "First follow-up" },
  { id: "s2", text: "Second follow-up" },
];

beforeEach(() => {
  // Reset to a known empty state between tests — the store is module-global.
  clearFollowupSuggestions(THREAD_A);
  clearFollowupSuggestions(THREAD_B);
});

describe("followupSuggestions store", () => {
  it("setFollowupSuggestions stores per-thread and isolates threads", () => {
    setFollowupSuggestions(THREAD_A, SUGGESTIONS);
    expect(getForTest(THREAD_A)).toEqual(SUGGESTIONS);
    expect(getForTest(THREAD_B)).toBeUndefined();
  });

  it("overwrites prior suggestions on re-set", () => {
    setFollowupSuggestions(THREAD_A, SUGGESTIONS);
    const next: FollowupSuggestion[] = [{ id: "s3", text: "Different" }];
    setFollowupSuggestions(THREAD_A, next);
    expect(getForTest(THREAD_A)).toEqual(next);
  });

  it("setting an empty array deletes the thread entry", () => {
    setFollowupSuggestions(THREAD_A, SUGGESTIONS);
    setFollowupSuggestions(THREAD_A, []);
    expect(getForTest(THREAD_A)).toBeUndefined();
  });

  it("clearFollowupSuggestions removes only the target thread", () => {
    setFollowupSuggestions(THREAD_A, SUGGESTIONS);
    setFollowupSuggestions(THREAD_B, SUGGESTIONS);

    clearFollowupSuggestions(THREAD_A);

    expect(getForTest(THREAD_A)).toBeUndefined();
    expect(getForTest(THREAD_B)).toEqual(SUGGESTIONS);
  });

  it("clearFollowupSuggestions on unknown thread is a no-op", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    try {
      clearFollowupSuggestions("never-set");
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("notifies subscribers on set and clear", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    try {
      setFollowupSuggestions(THREAD_A, SUGGESTIONS);
      expect(listener).toHaveBeenCalledTimes(1);

      clearFollowupSuggestions(THREAD_A);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeForTest(listener);
    unsubscribe();
    setFollowupSuggestions(THREAD_A, SUGGESTIONS);
    expect(listener).not.toHaveBeenCalled();
  });
});
