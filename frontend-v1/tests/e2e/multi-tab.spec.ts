import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  expectThreadRowVisible,
  renameActiveThread,
  sendMessage,
  signInWithDevToken,
  threadName,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

// Two tabs in the same browser context sign in independently (sessionStorage
// is per-tab). The thread created in tab A by sending a message must be
// visible in tab B after its own hydration via GET /threads.
//
// This exercises backend-as-source-of-truth for linked-thread metadata
// across tabs.
test("backend-linked thread created in tab A is visible in tab B after sign-in", async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);

  // Tab A: sign in and create a linked thread.
  await signInWithDevToken(page);
  const linkedName = threadName("multi-tab");

  await renameActiveThread(page, linkedName);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Create a thread that tab B should see.");
  await runResponsePromise;
  await expectThreadRowVisible(page, linkedName);

  // Tab B: new page in same browser context. sessionStorage is per-tab, so
  // tab B starts signed-out. Sign it in via the dev-token flow.
  const tabB = await context.newPage();
  const tabBListPromise = tabB.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/threads$/.test(response.url()) &&
      response.ok(),
  );
  await signInWithDevToken(tabB);
  await tabBListPromise;

  // Tab B should see the thread via backend hydration.
  await expect(
    tabB
      .locator('[data-testid="thread-item"]')
      .filter({ has: tabB.getByText(linkedName, { exact: true }) }),
  ).toHaveCount(1, { timeout: 10_000 });

  // Tab A is unaffected — its local state is intact.
  await expectThreadRowVisible(page, linkedName);

  // Tab B logs out — tab A is independent and stays signed in
  // (sessionStorage is per-tab).
  await tabB.evaluate(() => {
    window.sessionStorage.clear();
  });
  await tabB.reload();
  await expect(tabB.getByText("Anonymous")).toBeVisible();

  // Tab A's session and linked thread are still present.
  await page.bringToFront();
  await expect(page.getByText("playwright@example.com")).toBeVisible();
  await expectThreadRowVisible(page, linkedName);

  await tabB.close();
});
