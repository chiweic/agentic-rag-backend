import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  sendMessage,
  signInWithDevToken,
  trackRequests,
  waitForAssistantTextStart,
  waitForRunToComplete,
} from "./helpers";

const longPrompt =
  "Tell me a long story about a traveler crossing a desert, and start answering immediately.";
const shortPrompt = "hello";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

test("core: anonymous short query completes", async ({ page }) => {
  await expect(page.getByText("Anonymous")).toBeVisible();

  const completionRequests = trackRequests(page, /\/v1\/chat\/completions$/);
  const threadCreateRequests = trackRequests(page, /\/threads$/);
  const completionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/v1/chat/completions") &&
      response.ok(),
  );

  await sendMessage(page, shortPrompt);
  await completionResponsePromise;
  await waitForAssistantTextStart(page, 20_000);
  await waitForRunToComplete(page, 45_000);

  completionRequests.stop();
  threadCreateRequests.stop();

  expect(completionRequests.hits.length).toBeGreaterThan(0);
  expect(threadCreateRequests.hits).toHaveLength(0);
});

test("core: anonymous long query starts streaming", async ({ page }) => {
  test.setTimeout(60_000);
  await expect(page.getByText("Anonymous")).toBeVisible();

  const completionRequests = trackRequests(page, /\/v1\/chat\/completions$/);
  const threadCreateRequests = trackRequests(page, /\/threads$/);
  const completionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/v1/chat/completions") &&
      response.ok(),
  );

  await sendMessage(page, longPrompt);
  await completionResponsePromise;
  await waitForAssistantTextStart(page, 20_000);

  completionRequests.stop();
  threadCreateRequests.stop();

  expect(completionRequests.hits.length).toBeGreaterThan(0);
  expect(threadCreateRequests.hits).toHaveLength(0);
});

test("core: signed-in short query completes", async ({ page }) => {
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

  await sendMessage(page, shortPrompt);
  await threadCreateResponsePromise;
  await threadRunResponsePromise;
  await waitForAssistantTextStart(page, 20_000);
  await waitForRunToComplete(page, 45_000);

  threadCreateRequests.stop();
  threadRunRequests.stop();
  completionRequests.stop();

  expect(threadCreateRequests.hits.length).toBeGreaterThan(0);
  expect(threadRunRequests.hits.length).toBeGreaterThan(0);
  expect(completionRequests.hits).toHaveLength(0);
});
