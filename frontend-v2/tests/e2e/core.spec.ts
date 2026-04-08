import { expect, test } from "@playwright/test";

const BACKEND_URL = process.env["E2E_BACKEND_URL"] ?? "http://localhost:7081";
const LOGTO_APP_ID = process.env["LOGTO_APP_ID"] ?? "";

// ---------- helpers ----------

/** Mint a dev token from the backend and wire up the page for authenticated access. */
async function signIn(page: import("@playwright/test").Page) {
  // 1. Mint a dev JWT via the backend's dev signer
  const res = await fetch(`${BACKEND_URL}/auth/dev-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sub: "e2e-test-user",
      email: "e2e@test.local",
      name: "E2E User",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to mint dev token: ${res.status}. Is backend running with AUTH_DEV_MODE=true?`,
    );
  }
  const { access_token } = await res.json();

  // 2. Intercept the frontend's /api/auth/token calls → return the dev token
  await page.route("**/api/auth/token", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accessToken: access_token }),
    }),
  );

  // 3. Set a session cookie so middleware doesn't redirect to sign-in
  await page.context().addCookies([
    {
      name: `logto_${LOGTO_APP_ID}`,
      value: "e2e-session-bypass",
      domain: "localhost",
      path: "/",
    },
  ]);

  await page.goto("/");
}

/** Type a message, wait for send to enable, send it, wait for response. */
async function sendAndWaitForResponse(
  page: import("@playwright/test").Page,
  message: string,
) {
  const input = page.locator('[aria-label="Message input"]');
  await expect(input).toBeVisible({ timeout: 15_000 });

  // Click to focus, then fill; if send stays disabled, retry via keyboard
  await input.click();
  await input.fill(message);

  const sendButton = page.locator('[aria-label="Send message"]');
  try {
    await expect(sendButton).toBeEnabled({ timeout: 5_000 });
  } catch {
    // fill may not trigger React state update — retry with keyboard
    await input.clear();
    await page.keyboard.type(message, { delay: 30 });
  }
  await expect(sendButton).toBeEnabled({ timeout: 15_000 });
  await sendButton.click();

  const assistantMessage = page.locator('[data-role="assistant"]').first();
  await expect(assistantMessage).toBeVisible({ timeout: 30_000 });
  return assistantMessage;
}

// ---------- sign-in flow ----------

test.describe("sign-in flow", () => {
  test("unauthenticated user is redirected away from chat", async ({
    page,
  }) => {
    // Without a session cookie, middleware redirects to sign-in
    await page.goto("/");
    // Should not see the chat input (redirected or blocked)
    await expect(page.locator('[aria-label="Message input"]')).not.toBeVisible({
      timeout: 10_000,
    });
  });

  test("authenticated user sees the chat page", async ({ page }) => {
    await signIn(page);
    await expect(page.locator("text=New Thread")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('[aria-label="Message input"]')).toBeVisible();
  });
});

// ---------- send message + streaming ----------

test.describe("send message + streaming", () => {
  test("send hello and see streaming response", async ({ page }) => {
    await signIn(page);

    const assistantMessage = await sendAndWaitForResponse(page, "hello");
    await expect(assistantMessage).not.toBeEmpty();
  });
});

// ---------- thread management ----------

test.describe("thread management", () => {
  test.describe.configure({ timeout: 60_000 });

  test("create a new thread", async ({ page }) => {
    await signIn(page);

    await page.locator("text=New Thread").click();
    await expect(page.locator('[aria-label="Message input"]')).toBeVisible();
  });

  test("switch between threads", async ({ page }) => {
    await signIn(page);

    // Create first thread with a unique message
    await sendAndWaitForResponse(page, "switch test alpha");

    // Create a new thread and send a different message
    await page.locator("text=New Thread").click();
    await sendAndWaitForResponse(page, "switch test beta");

    // The sidebar should show the first thread — click it by title
    // Backend's generate-title may transform case, so use case-insensitive match
    const firstThread = page
      .getByRole("complementary")
      .getByRole("button", { name: /switch test alpha/i })
      .first();
    await expect(firstThread).toBeVisible({ timeout: 10_000 });
    await firstThread.click();

    // Should load the first thread's user message in the content area
    await expect(
      page
        .locator('[data-role="user"]')
        .filter({ hasText: /switch test alpha/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("delete a thread", async ({ page }) => {
    await signIn(page);

    // Wait for UI to fully load before interacting
    await expect(page.locator("text=New Thread")).toBeVisible({
      timeout: 10_000,
    });

    // Create a thread with a message
    await sendAndWaitForResponse(page, "please delete this thread");

    // The newly created thread appears in the sidebar. The user message
    // "please delete this thread" is visible in the main content area.
    const mainContent = page.getByRole("main");
    await expect(
      mainContent.locator("text=please delete this thread"),
    ).toBeVisible({ timeout: 10_000 });

    // Get the sidebar thread list — each thread item is a group of buttons.
    // Archive/Delete buttons are revealed on hover.
    const sidebar = page.getByRole("complementary");

    // Hover the first thread item (the one we just created)
    const threadListArea = sidebar.locator("div.space-y-1 > div").first();
    await threadListArea.hover();

    // Click the Delete action button
    await threadListArea
      .getByRole("button", { name: "Delete", exact: true })
      .click();

    // After deletion, the message should no longer be in the content area
    await expect(
      mainContent.locator("text=please delete this thread"),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

// ---------- multi-user isolation ----------

test.describe("multi-user isolation", () => {
  test("sign out removes access to chat", async ({ page }) => {
    await signIn(page);

    // Verify chat is visible
    await expect(page.locator('[aria-label="Message input"]')).toBeVisible({
      timeout: 10_000,
    });

    // Clear cookies to simulate sign-out (removes the session cookie)
    await page.context().clearCookies();

    // Navigate — middleware should redirect away from chat
    await page.goto("/");
    await expect(page.locator('[aria-label="Message input"]')).not.toBeVisible({
      timeout: 10_000,
    });
  });
});
