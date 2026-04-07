import { expect, test } from "@playwright/test";
import {
  clearBrowserState,
  expectThreadRowVisible,
  logoutFromAccountMenu,
  renameActiveThread,
  sendMessage,
  signInWithDevToken,
  threadName,
} from "./helpers";

const AUTH_STORAGE_KEY = "frontend-v1-auth-store";

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

test("persists a long linked-thread title across reload", async ({ page }) => {
  await signInWithDevToken(page);
  const longTitle = `${threadName("long-title")}-${"x".repeat(140)}`;

  await renameActiveThread(page, longTitle);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(page, "Persist this long thread title.");
  await runResponsePromise;

  await expectThreadRowVisible(page, longTitle);
  await page.reload();
  await expectThreadRowVisible(page, longTitle);
  await expect(
    page
      .locator('[data-testid="thread-item"]')
      .filter({ has: page.getByText(longTitle, { exact: true }) }),
  ).toHaveCount(1);
});

test("preserves a higher count of local-only threads across reload", async ({
  page,
}) => {
  const names = Array.from({ length: 6 }, (_, index) =>
    threadName(`local-bulk-${index + 1}`),
  );

  for (const name of names) {
    await page.getByRole("button", { name: "New Thread" }).click();
    await renameActiveThread(page, name);
    await expectThreadRowVisible(page, name);
  }

  await page.reload();

  for (const name of names) {
    await expectThreadRowVisible(page, name);
  }
});

test("invalid persisted token forces sign-out on the next protected fetch", async ({
  page,
}) => {
  await signInWithDevToken(page);
  await expect(page.getByText("playwright@example.com")).toBeVisible();

  await page.evaluate((storageKey) => {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) throw new Error("Missing auth storage");
    const parsed = JSON.parse(raw) as {
      state?: { token?: string | null };
      version?: number;
    };
    if (!parsed.state) throw new Error("Missing auth state");
    parsed.state.token = "invalid.dev.token";
    window.sessionStorage.setItem(storageKey, JSON.stringify(parsed));
  }, AUTH_STORAGE_KEY);

  await page.goto("/assisted-learning");

  await expect(
    page.getByText("Sign in to access the protected learning modules."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Assisted Learning" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Anonymous")).toBeVisible();
  await expect(page.getByText("playwright@example.com")).toHaveCount(0);
  await page.evaluate((storageKey) => {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
    if (parsed.state?.token) {
      throw new Error("Auth token was not cleared after invalid session");
    }
  }, AUTH_STORAGE_KEY);
});

test("deleted linked thread does not reappear after logout and a fresh login", async ({
  page,
}) => {
  await signInWithDevToken(page);
  const name = threadName("delete-fresh-login");

  await renameActiveThread(page, name);
  const runResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/threads/") &&
      response.url().includes("/runs/stream"),
  );
  await sendMessage(
    page,
    "Delete this thread and ensure it stays gone after a fresh session.",
  );
  await runResponsePromise;

  await page
    .locator('[data-testid="thread-item"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .getByRole("button", { name: `Delete ${name}` })
    .click();
  await expect(page.getByText(name)).toHaveCount(0);

  await logoutFromAccountMenu(page);
  await signInWithDevToken(page);
  await expect(page.getByText(name)).toHaveCount(0);
});
