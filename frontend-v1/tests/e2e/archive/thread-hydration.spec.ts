import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  deleteThreadByName,
  expectThreadRowVisible,
  expectThreadSyncStatus,
  logoutFromAccountMenu,
  renameActiveThread,
  sendMessage,
  signInWithDevToken,
  threadName,
  threadPrimaryButtonByName,
  threadRowByName,
  trackRequests,
  waitForRunToSettle,
  waitForThreadHistoryToDisappear,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

test("rehydrates backend-linked thread metadata after reload", async ({
  page,
}) => {
  await signInWithDevToken(page);
  const initialName = threadName("rehydrate");
  const renamedName = `${initialName}-updated`;

  await renameActiveThread(page, initialName);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Hello! How does the external store work?");
  await runResponsePromise;

  await expectThreadSyncStatus(page, initialName, "Linked");

  await renameActiveThread(page, renamedName);
  await expectThreadRowVisible(page, renamedName);
  await expectThreadSyncStatus(page, renamedName, "Linked");

  const stateResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/threads/") &&
      response.url().endsWith("/state"),
  );
  await page.reload();
  await stateResponsePromise;

  await expectThreadRowVisible(page, renamedName);
  await expectThreadSyncStatus(page, renamedName, "Linked");
  await expect(
    page
      .locator('[data-testid="thread-item"]')
      .filter({ has: page.getByText(renamedName, { exact: true }) }),
  ).toHaveCount(1);
});

test("preserves both linked and local-only threads across reload without duplication", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signInWithDevToken(page);
  const linkedName = threadName("linked");
  const localOnlyName = threadName("local");

  await renameActiveThread(page, linkedName);
  const runRequests = trackRequests(page, /\/threads\/.*\/runs\/stream$/);
  const completionRequests = trackRequests(page, /\/v1\/chat\/completions$/);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(
    page,
    "Tell me a short story about a robot learning to paint.",
  );
  await runResponsePromise;
  await waitForRunToSettle(page);
  expect(runRequests.hits.length).toBeGreaterThan(0);
  expect(completionRequests.hits).toHaveLength(0);
  runRequests.stop();
  completionRequests.stop();
  await expectThreadSyncStatus(page, linkedName, "Linked");

  await page.getByRole("button", { name: "New Thread" }).click();
  await renameActiveThread(page, localOnlyName);
  await expectThreadRowVisible(page, localOnlyName);

  const stateRequests = trackRequests(page, /\/threads\/.*\/state$/);
  await page.reload();
  await page.waitForLoadState("networkidle");
  stateRequests.stop();

  await expectThreadRowVisible(page, linkedName);
  await expectThreadSyncStatus(page, linkedName, "Linked");
  await expectThreadRowVisible(page, localOnlyName);
  expect(stateRequests.hits).toHaveLength(0);
  await expect(
    page
      .locator('[data-testid="thread-item"]')
      .filter({ has: page.getByText(linkedName, { exact: true }) }),
  ).toHaveCount(1);
  await expect(
    page
      .locator('[data-testid="thread-item"]')
      .filter({ has: page.getByText(localOnlyName, { exact: true }) }),
  ).toHaveCount(1);
});

test("reopened linked thread loads history after logout and login without sending a new message", async ({
  page,
}) => {
  await signInWithDevToken(page);
  const linkedName = threadName("reopen");
  const firstMessage =
    "Persist this linked-thread history across auth boundary.";

  await renameActiveThread(page, linkedName);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, firstMessage);
  await runResponsePromise;
  await waitForRunToSettle(page);

  await logoutFromAccountMenu(page);
  await expect(page.getByText("Anonymous")).toBeVisible();

  await signInWithDevToken(page);
  await expectThreadRowVisible(page, linkedName);

  const stateResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response.url().includes("/threads/") &&
      response.url().endsWith("/state"),
  );
  await threadPrimaryButtonByName(page, linkedName).click();
  await stateResponsePromise;

  await expect(page.getByText(firstMessage)).toBeVisible();
  await waitForThreadHistoryToDisappear(threadRowByName(page, linkedName));
});

test("deleted linked thread stays deleted after reload and re-login", async ({
  page,
}) => {
  await signInWithDevToken(page);
  const linkedName = threadName("delete");

  await renameActiveThread(page, linkedName);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Delete this linked thread and keep it gone.");
  await runResponsePromise;

  await expectThreadRowVisible(page, linkedName);
  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().includes("/threads/"),
  );
  await deleteThreadByName(page, linkedName);
  await deleteResponsePromise;
  await expect(page.getByText(linkedName)).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(linkedName)).toHaveCount(0);

  await logoutFromAccountMenu(page);
  await signInWithDevToken(page);
  await expect(page.getByText(linkedName)).toHaveCount(0);
});
