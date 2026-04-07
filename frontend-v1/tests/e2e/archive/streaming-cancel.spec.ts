import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  expectThreadSyncStatus,
  renameActiveThread,
  sendMessage,
  signInWithDevToken,
  threadName,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

// Cancelling a linked-thread run must:
//   - stop the in-flight request (isRunning returns to false)
//   - preserve the user's message locally
//   - leave the app in a usable state so the user can send again
//
// Note on backend behavior: LangGraph's astream_events does not currently
// propagate client disconnects, so the server continues generation even
// after the client aborts. The assistant message may therefore appear in
// the backend checkpointer state after cancellation. This test documents
// that behavior without depending on it.
test("cancelling a linked-thread run preserves local state and allows retry", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signInWithDevToken(page);
  const linkedName = threadName("cancel");

  await renameActiveThread(page, linkedName);

  // Prime the thread with a short first turn so we get a backend thread id
  // before we start cancelling things.
  const firstRunPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Hi — just a warmup.");
  await firstRunPromise;
  await expectThreadSyncStatus(page, linkedName, "Linked");
  // Wait for the warmup to actually complete before the cancel attempt.
  await expect(
    page.getByRole("button", { name: "Send message" }),
  ).toBeVisible();

  // Send a prompt that should produce a long response and then cancel mid-flight.
  const longPrompt =
    "Write a long detailed essay about the history of the Renaissance, at least 1000 words, covering art, science, politics, religion, and daily life.";
  const runStartedPromise = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      /\/threads\/[^/]+\/runs\/stream$/.test(request.url()),
  );
  await sendMessage(page, longPrompt);
  await runStartedPromise;

  // Click "Stop generating" as soon as the cancel button is available.
  const cancelButton = page.getByRole("button", { name: "Stop generating" });
  await cancelButton.click();

  // After cancel, the send button must come back — the run stopped locally.
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout: 10_000,
  });
  await expect(cancelButton).toHaveCount(0);

  // The user's cancelled prompt must still be visible in the thread.
  await expect(
    page.getByText(longPrompt, { exact: false }).first(),
  ).toBeVisible();

  // A follow-up send must still work (no stuck isRunning, no stale abort).
  const followUpPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/threads\/[^/]+\/runs\/stream$/.test(response.url()) &&
      response.ok(),
  );
  await sendMessage(page, "Short follow-up after cancel.");
  await followUpPromise;

  // Send button returns again after the follow-up completes.
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Short follow-up after cancel.").first(),
  ).toBeVisible();
});
