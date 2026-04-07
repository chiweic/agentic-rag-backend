import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  expectThreadRowVisible,
  expectThreadSyncStatus,
  renameActiveThread,
  sendMessage,
  signInWithDevToken,
  threadName,
  threadRowByName,
  waitForRunToSettle,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

// Rename: optimistic local update is kept, but sync status flips to "Sync error"
// when PATCH /threads/{id} fails.
test("rename failure keeps optimistic title and surfaces Sync error", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signInWithDevToken(page);
  const initialName = threadName("rename-fail");
  const failedRename = `${initialName}-failed`;

  // Create a linked thread first (needs a backend run to attach backendThreadId).
  await renameActiveThread(page, initialName);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Create a linked thread to test rename failure.");
  await runResponsePromise;
  await waitForRunToSettle(page);
  await expectThreadSyncStatus(page, initialName, "Linked");

  // Force the *next* PATCH /threads/{id} to fail.
  await page.route(/\/threads\/[^/]+$/, async (route, request) => {
    if (request.method() === "PATCH") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Simulated backend failure" }),
      });
      return;
    }
    await route.fallback();
  });

  const patchResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/threads\/[^/]+$/.test(response.url()),
  );
  await renameActiveThread(page, failedRename);
  await patchResponsePromise;

  // Optimistic local rename is preserved (not reverted).
  await expectThreadRowVisible(page, failedRename);
  await expectThreadSyncStatus(page, failedRename, "Sync error");

  // Now let subsequent PATCH succeed and assert a retry via a second rename restores "Linked".
  await page.unroute(/\/threads\/[^/]+$/);
  const retriedName = `${initialName}-retried`;
  const retryPatchPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/threads\/[^/]+$/.test(response.url()) &&
      response.ok(),
  );
  await renameActiveThread(page, retriedName);
  await retryPatchPromise;

  await expectThreadRowVisible(page, retriedName);
  await expectThreadSyncStatus(page, retriedName, "Linked");
});

// Delete: thread is removed optimistically, then restored at its original index
// with syncStatus "error" when DELETE /threads/{id} fails.
test("delete failure restores thread at original index with Sync error", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signInWithDevToken(page);
  const olderName = threadName("delete-fail-older");
  const targetName = threadName("delete-fail-target");
  const newerName = threadName("delete-fail-newer");

  // Create three linked threads so we can verify restoration index.
  // Thread 1 (older) — first-created linked thread.
  await renameActiveThread(page, olderName);
  const olderRunPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Older thread message.");
  await olderRunPromise;
  await waitForRunToSettle(page);
  await expectThreadSyncStatus(page, olderName, "Linked");

  // Thread 2 (target) — the one we will attempt to delete.
  await page.getByRole("button", { name: "New Thread" }).click();
  await renameActiveThread(page, targetName);
  const targetRunPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Target thread message.");
  await targetRunPromise;
  await waitForRunToSettle(page);
  await expectThreadSyncStatus(page, targetName, "Linked");

  // Thread 3 (newer).
  await page.getByRole("button", { name: "New Thread" }).click();
  await renameActiveThread(page, newerName);
  const newerRunPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Newer thread message.");
  await newerRunPromise;
  await waitForRunToSettle(page);
  await expectThreadSyncStatus(page, newerName, "Linked");

  // Capture the pre-delete order by index of target row.
  const threadItems = page.locator('[data-testid="thread-item"]');
  const preDeleteNames = await threadItems.allInnerTexts();
  const preDeleteTargetIndex = preDeleteNames.findIndex((text) =>
    text.includes(targetName),
  );
  expect(preDeleteTargetIndex).toBeGreaterThanOrEqual(0);

  // Force the next DELETE /threads/{id} to fail.
  await page.route(/\/threads\/[^/]+$/, async (route, request) => {
    if (request.method() === "DELETE") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Simulated backend failure" }),
      });
      return;
    }
    await route.fallback();
  });

  const deleteResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      /\/threads\/[^/]+$/.test(response.url()),
  );
  await threadRowByName(page, targetName)
    .getByRole("button", { name: `Delete ${targetName}` })
    .click();
  await deleteResponsePromise;

  // Row is restored and shows Sync error.
  await expectThreadRowVisible(page, targetName);
  await expectThreadSyncStatus(page, targetName, "Sync error");

  // Restored at its original index (between older and newer).
  const postRestoreNames = await threadItems.allInnerTexts();
  const postRestoreTargetIndex = postRestoreNames.findIndex((text) =>
    text.includes(targetName),
  );
  expect(postRestoreTargetIndex).toBe(preDeleteTargetIndex);

  // All three threads are still present and unique.
  await expectThreadRowVisible(page, olderName);
  await expectThreadRowVisible(page, newerName);
  await expect(
    threadItems.filter({ has: page.getByText(targetName, { exact: true }) }),
  ).toHaveCount(1);
});
