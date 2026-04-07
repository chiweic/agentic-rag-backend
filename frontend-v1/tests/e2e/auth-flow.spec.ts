import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  logoutFromAccountMenu,
  openAccountMenu,
  renameActiveThread,
  sendMessage,
  signInWithDevToken,
  threadName,
  trackRequests,
  waitForRunToSettle,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

test("signed-out baseline chat still uses /v1/chat/completions", async ({
  page,
}) => {
  await expect(page.getByText("Anonymous")).toBeVisible();

  const completionRequests = trackRequests(page, /\/v1\/chat\/completions$/);
  const threadCreateRequests = trackRequests(page, /\/threads$/);
  const completionResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/v1/chat/completions"),
  );

  await sendMessage(page, "Say hello from the signed-out baseline.");
  await completionResponsePromise;

  completionRequests.stop();
  threadCreateRequests.stop();

  expect(completionRequests.hits.length).toBeGreaterThan(0);
  expect(threadCreateRequests.hits).toHaveLength(0);
});

test("signed-out users are gated from Assisted Learning", async ({ page }) => {
  await page.goto("/assisted-learning");
  await expect(
    page.getByRole("heading", { name: "Assisted Learning" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("dev-token sign-in unlocks linked threads and Assisted Learning, and logout clears state", async ({
  page,
}) => {
  await signInWithDevToken(page);

  await expect(page.getByText("playwright@example.com")).toBeVisible();
  await openAccountMenu(page);
  await expect(
    page
      .getByTestId("account-menu-content")
      .getByRole("link", { name: "Assisted Learning" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  const threadCreateRequests = trackRequests(page, /\/threads$/);
  const threadRunRequests = trackRequests(page, /\/threads\/.*\/runs\/stream$/);
  const completionRequests = trackRequests(page, /\/v1\/chat\/completions$/);
  const threadCreateResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/threads$/.test(response.url()),
  );
  const threadRunResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/threads\/.*\/runs\/stream$/.test(response.url()),
  );

  await sendMessage(page, "Create a backend-linked thread for auth E2E.");
  await threadCreateResponsePromise;
  await threadRunResponsePromise;

  threadCreateRequests.stop();
  threadRunRequests.stop();
  completionRequests.stop();

  expect(threadCreateRequests.hits.length).toBeGreaterThan(0);
  expect(threadRunRequests.hits.length).toBeGreaterThan(0);
  expect(completionRequests.hits).toHaveLength(0);

  await page.goto("/assisted-learning");
  await expect(page.getByText("Intro to Agentic RAG")).toBeVisible();
  await expect(page.getByText("Dense vs Sparse Retrieval")).toBeVisible();

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await logoutFromAccountMenu(page);

  await expect(page.getByText("Anonymous")).toBeVisible();
  await expect(page.getByText("playwright@example.com")).toHaveCount(0);
});

test("logout clears linked thread shells and returns to the signed-out baseline thread", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signInWithDevToken(page);
  const linkedName = threadName("logout-clear");

  await renameActiveThread(page, linkedName);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(
    page,
    "Create a linked thread that should disappear after logout.",
  );
  await runResponsePromise;
  await waitForRunToSettle(page);
  await logoutFromAccountMenu(page);

  await expect(page.getByText("Anonymous")).toBeVisible();
  await expect(page.getByText(linkedName)).toHaveCount(0);
  await expect(page.getByText("thread-1")).toBeVisible();
});
