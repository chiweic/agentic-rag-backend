import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  sendMessage,
  signInWithDevToken,
  trackRequests,
  waitForAssistantText,
} from "./helpers";

const longPrompt =
  "Tell me a long story about a traveler crossing a desert, and start answering immediately.";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

test("core: app starts, signed-in user sends a long query, and first assistant text appears", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await signInWithDevToken(page);
  await expect(page.getByText("playwright@example.com")).toBeVisible();

  const threadCreateRequests = trackRequests(page, /\/threads$/);
  const threadRunRequests = trackRequests(page, /\/threads\/.*\/runs\/stream$/);
  const completionRequests = trackRequests(page, /\/v1\/chat\/completions$/);

  const threadCreateResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/threads$/.test(response.url()) &&
      response.ok(),
  );
  const threadRunResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/threads\/.*\/runs\/stream$/.test(response.url()) &&
      response.ok(),
  );

  await sendMessage(page, longPrompt);
  await threadCreateResponsePromise;
  await threadRunResponsePromise;
  await waitForAssistantText(page, 20_000);

  threadCreateRequests.stop();
  threadRunRequests.stop();
  completionRequests.stop();

  expect(threadCreateRequests.hits.length).toBeGreaterThan(0);
  expect(threadRunRequests.hits.length).toBeGreaterThan(0);
  expect(completionRequests.hits).toHaveLength(0);
});
