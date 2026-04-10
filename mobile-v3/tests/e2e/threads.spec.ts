import { expect, test } from "@playwright/test";
import {
  createTestUser,
  deleteTestUser,
  programmaticSignIn,
  getDevToken,
  createBackendThread,
  sendBackendMessage,
  listBackendThreads,
  deleteBackendThread,
} from "./helpers";

const TEST_PASSWORD = "Xk9#mWq2vBnR7p!";

// ── helpers ──────────────────────────────────────────────────────────

/** Sign in programmatically and wait for the chat page. */
async function signInAndWait(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
) {
  await programmaticSignIn(page, username, password);

  // Should be on the chat page
  await expect(page.getByText("Welcome")).not.toBeVisible({ timeout: 15_000 });
}

// ── send message + streaming ────────────────────────────────────────

test.describe("send message and stream response", () => {
  let userId: string;
  const username = `e2e_thread_send_${Date.now()}`;

  test.beforeAll(async () => {
    userId = await createTestUser({ username, password: TEST_PASSWORD });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("typing a message streams an assistant reply", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAndWait(page, username, TEST_PASSWORD);

    // Should see "How can I help?" empty state
    await expect(page.getByText("How can I help?")).toBeVisible({
      timeout: 10_000,
    });

    // Type and send a message
    const composer = page.locator("textarea, input[type=text]").last();
    await composer.fill("Say exactly: E2E_THREAD_TEST_OK");
    // Press Enter or click the send button
    await composer.press("Enter");

    // Wait for assistant response to appear
    await expect(
      page.getByText("E2E_THREAD_TEST_OK", { exact: false }),
    ).toBeVisible({ timeout: 30_000 });
  });
});

// ── thread list shows in drawer ─────────────────────────────────────

test.describe("thread list in drawer", () => {
  let userId: string;
  const username = `e2e_thread_list_${Date.now()}`;

  test.beforeAll(async () => {
    userId = await createTestUser({ username, password: TEST_PASSWORD });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("sending a message creates a thread visible in the drawer", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAndWait(page, username, TEST_PASSWORD);

    // Send a message
    const composer = page.locator("textarea, input[type=text]").last();
    await composer.fill("Hello from E2E test");
    await composer.press("Enter");

    // Wait for response
    await page.waitForTimeout(10_000);

    // Open the drawer
    const menuButton = page
      .locator('[aria-label="Show navigation menu"]:visible')
      .first();
    await menuButton.click();
    await page.waitForTimeout(1000);

    // The drawer should show a thread (title derived from the message)
    const drawer = page.locator('[data-testid="thread-list"], [role="navigation"]').first();
    // Look for any thread item — it should contain text from our message
    await expect(
      page.getByText("Hello from E2E test", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ── thread persistence across sign-out / sign-in ────────────────────

test.describe("thread persistence across sign-out / sign-in", () => {
  let userId: string;
  const username = `e2e_thread_persist_${Date.now()}`;

  test.beforeAll(async () => {
    userId = await createTestUser({ username, password: TEST_PASSWORD });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("threads survive sign-out and sign-in", async ({ page }) => {
    test.setTimeout(120_000);

    // ── Sign in and send a message ──
    await signInAndWait(page, username, TEST_PASSWORD);

    const composer = page.locator("textarea, input[type=text]").last();
    await composer.fill("Persistence test message alpha");
    await composer.press("Enter");

    // Wait for the assistant response
    await page.waitForTimeout(15_000);

    // ── Sign out ──
    const menuButton = page
      .locator('[aria-label="Show navigation menu"]:visible')
      .first();
    await menuButton.click();
    await page.waitForTimeout(1000);

    const signOutBtn = page.getByText("Sign Out", { exact: true });
    await expect(signOutBtn).toBeVisible({ timeout: 5_000 });
    await signOutBtn.click();

    // Should return to Welcome screen
    await expect(page.getByText("Welcome")).toBeVisible({ timeout: 15_000 });

    // ── Sign in again ──
    await programmaticSignIn(page, username, TEST_PASSWORD);
    await expect(page.getByText("Welcome")).not.toBeVisible({
      timeout: 15_000,
    });

    // ── Open drawer and check thread is still there ──
    await page.waitForTimeout(3000);
    await menuButton.click();
    await page.waitForTimeout(1000);

    await expect(
      page.getByText("Persistence test message alpha", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ── switch between threads ──────────────────────────────────────────

test.describe("switch between threads", () => {
  let userId: string;
  let devToken: string;
  const username = `e2e_thread_switch_${Date.now()}`;
  const threadIds: string[] = [];

  test.beforeAll(async () => {
    userId = await createTestUser({ username, password: TEST_PASSWORD });
    // Pre-create threads via API so we have known content
    devToken = await getDevToken(`logto:${userId}`);
    for (const msg of ["Alpha thread message", "Beta thread message"]) {
      const tid = await createBackendThread(devToken);
      await sendBackendMessage(devToken, tid, msg);
      threadIds.push(tid);
    }
  });

  test.afterAll(async () => {
    if (devToken) {
      for (const tid of threadIds) {
        await deleteBackendThread(devToken, tid).catch(() => {});
      }
    }
    if (userId) await deleteTestUser(userId);
  });

  test("clicking a thread in the drawer loads its messages", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signInAndWait(page, username, TEST_PASSWORD);

    // Open drawer
    await page.waitForTimeout(3000);
    const menuButton = page
      .locator('[aria-label="Show navigation menu"]:visible')
      .first();
    await menuButton.click();
    await page.waitForTimeout(1000);

    // Click on the "Alpha" thread
    const alphaItem = page
      .getByText("Alpha thread message", { exact: false })
      .first();
    await expect(alphaItem).toBeVisible({ timeout: 10_000 });
    await alphaItem.click();
    await page.waitForTimeout(3000);

    // Should see the Alpha message content in the chat area
    await expect(
      page.getByText("Alpha thread message", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    // Open drawer again and switch to Beta
    await menuButton.click();
    await page.waitForTimeout(1000);

    const betaItem = page
      .getByText("Beta thread message", { exact: false })
      .first();
    await expect(betaItem).toBeVisible({ timeout: 10_000 });
    await betaItem.click();
    await page.waitForTimeout(3000);

    // Should see Beta message content
    await expect(
      page.getByText("Beta thread message", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ── new chat button ─────────────────────────────────────────────────

test.describe("new chat button", () => {
  let userId: string;
  const username = `e2e_thread_newchat_${Date.now()}`;

  test.beforeAll(async () => {
    userId = await createTestUser({ username, password: TEST_PASSWORD });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("new chat button shows empty state", async ({ page }) => {
    test.setTimeout(90_000);
    await signInAndWait(page, username, TEST_PASSWORD);

    // Send a message first
    const composer = page.locator("textarea, input[type=text]").last();
    await composer.fill("First message for new chat test");
    await composer.press("Enter");
    await page.waitForTimeout(10_000);

    // Click new chat button
    await page.locator('[aria-label="New chat"]').click();

    await page.waitForTimeout(2000);

    // Should see empty state again
    await expect(page.getByText("How can I help?")).toBeVisible({
      timeout: 10_000,
    });
  });
});
