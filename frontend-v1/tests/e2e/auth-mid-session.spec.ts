import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  expectThreadSyncStatus,
  renameActiveThread,
  sendMessage,
  signInWithDevToken,
  threadName,
  waitForRunToSettle,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

// A 401 on the next protected action (rename of a linked thread) must
// invalidate the session: the user is signed out and returned to the
// Anonymous baseline.
test("401 on next protected action signs the user out", async ({ page }) => {
  test.setTimeout(60_000);
  await signInWithDevToken(page);
  const linkedName = threadName("401-next-action");

  await renameActiveThread(page, linkedName);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Create a linked thread for 401 testing.");
  await runResponsePromise;
  await waitForRunToSettle(page);
  await expectThreadSyncStatus(page, linkedName, "Linked");

  // Force the next PATCH /threads/{id} to return 401.
  await page.route(/\/threads\/[^/]+$/, async (route, request) => {
    if (request.method() === "PATCH") {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Token is expired" }),
      });
      return;
    }
    await route.fallback();
  });

  const patchResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/threads\/[^/]+$/.test(response.url()) &&
      response.status() === 401,
  );
  await renameActiveThread(page, `${linkedName}-renamed`);
  await patchResponsePromise;

  // Session was invalidated — user is back on the signed-out baseline.
  await expect(page.getByText("Anonymous")).toBeVisible();
  await expect(page.getByText("playwright@example.com")).toHaveCount(0);
  // Linked-thread shells are wiped by resetForAuthBoundary() — the default
  // thread-1 is the only row visible.
  await expect(page.getByText(linkedName)).toHaveCount(0);
  await expect(page.getByText(`${linkedName}-renamed`)).toHaveCount(0);
});

// A 401 returned by POST /threads/{id}/runs/stream mid-run must invalidate
// the session. The user is signed out and chat state is reset to the
// Anonymous baseline.
test("401 during run/stream signs the user out mid-run", async ({ page }) => {
  await signInWithDevToken(page);
  const linkedName = threadName("401-mid-run");

  // First, create and link a thread successfully.
  await renameActiveThread(page, linkedName);
  const firstRunPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Establish a linked thread first.");
  await firstRunPromise;
  await waitForRunToSettle(page);
  await expectThreadSyncStatus(page, linkedName, "Linked");

  // Force the *next* run/stream POST on this thread to return 401.
  await page.route(
    /\/threads\/[^/]+\/runs\/stream$/,
    async (route, request) => {
      if (request.method() === "POST") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Token is expired" }),
        });
        return;
      }
      await route.fallback();
    },
  );

  const failingRunPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/threads\/[^/]+\/runs\/stream$/.test(response.url()) &&
      response.status() === 401,
  );
  await sendMessage(page, "This run should hit a 401.");
  await failingRunPromise;

  // Session was invalidated — user is back on the signed-out baseline.
  await expect(page.getByText("Anonymous")).toBeVisible();
  await expect(page.getByText("playwright@example.com")).toHaveCount(0);
  await expect(page.getByText(linkedName)).toHaveCount(0);
  // Anonymous baseline default thread is visible.
  await expect(page.getByText("thread-1")).toBeVisible();
});
