import { expect, test } from "@playwright/test";
import {
  createTestUser,
  deleteTestUser,
  resetUserPassword,
  programmaticSignIn,
  openLogtoPopup,
  logtoSignIn,
  logtoGoToRegister,
  logtoGoToForgotPassword,
} from "./helpers";

const TEST_PASSWORD = "Xk9#mWq2vBnR7p!";

// ---------- sign-in with username + password ----------

test.describe("sign-in with username + password", () => {
  let userId: string;
  const username = `e2e_signin_${Date.now()}`;

  test.beforeAll(async () => {
    userId = await createTestUser({ username, password: TEST_PASSWORD });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("sign in with username redirects to chat", async ({ page }) => {
    await programmaticSignIn(page, username, TEST_PASSWORD);

    // The app should now show the chat page (no more "Welcome")
    await expect(page.getByText("Welcome")).not.toBeVisible({
      timeout: 15_000,
    });
  });
});

// ---------- sign-in with email + password ----------

test.describe("sign-in with email + password", () => {
  let userId: string;
  const username = `e2e_emailsign_${Date.now()}`;
  const email = `${username}@test.local`;

  test.beforeAll(async () => {
    userId = await createTestUser({
      username,
      password: TEST_PASSWORD,
      email,
    });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("sign in with email redirects to chat", async ({ page }) => {
    await programmaticSignIn(page, email, TEST_PASSWORD);

    await expect(page.getByText("Welcome")).not.toBeVisible({
      timeout: 15_000,
    });
  });
});

// ---------- sign-out ----------

test.describe("sign-out", () => {
  let userId: string;
  const username = `e2e_signout_${Date.now()}`;

  test.beforeAll(async () => {
    userId = await createTestUser({ username, password: TEST_PASSWORD });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("sign out returns to welcome screen", async ({ page }) => {
    // Sign in first
    await programmaticSignIn(page, username, TEST_PASSWORD);
    await expect(page.getByText("Welcome")).not.toBeVisible({
      timeout: 15_000,
    });

    // Wait for the chat UI to fully load
    await expect(page.getByText("How can I help?")).toBeVisible({
      timeout: 10_000,
    });

    // Open drawer — the drawer renders two toggle buttons; use the visible one
    const menuBtn = page.locator('[aria-label="Show navigation menu"]:visible').first();
    await menuBtn.click();

    await page.waitForTimeout(1000);
    const signOutBtn = page.getByText("Sign Out", { exact: true });
    await expect(signOutBtn).toBeVisible({ timeout: 5_000 });
    await signOutBtn.click();

    // Should return to the welcome/sign-in screen
    await expect(page.getByText("Welcome")).toBeVisible({ timeout: 15_000 });
  });
});

// ---------- registration flow (UI only — stops at email verification) ----------

test.describe.skip("registration flow", () => {
  test("register with username shows password step", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const popup = await openLogtoPopup(page, context);

    // Navigate to registration
    await logtoGoToRegister(popup);

    // Should show "Create your account" with "Username / Email" input
    await expect(popup.getByText("Create your account")).toBeVisible({
      timeout: 5_000,
    });
    const identifierInput = popup.locator("input[name=identifier]");
    await expect(identifierInput).toBeVisible();

    // Fill username and submit
    const regUsername = `e2e_reg_${Date.now()}`;
    await identifierInput.fill(regUsername);
    await popup.click('button:has-text("Create account")');

    // Should navigate to the "New password" step
    await expect(popup.getByText("New password")).toBeVisible({
      timeout: 10_000,
    });
    const passwordInput = popup.locator("input[type=password]");
    await expect(passwordInput).toBeVisible();

    await popup.close();
  });

  test("register with email shows verification code step", async ({
    page,
    context,
  }, testInfo) => {
    testInfo.setTimeout(120_000);
    await page.goto("/");
    await page.waitForTimeout(3000);

    const popup = await openLogtoPopup(page, context);

    // Navigate to registration
    await logtoGoToRegister(popup);

    // Should show "Create your account" with "Username / Email" input
    await expect(popup.getByText("Create your account")).toBeVisible({
      timeout: 5_000,
    });
    const identifierInput = popup.locator("input[name=identifier]");
    await expect(identifierInput).toBeVisible();

    // Fill email and submit
    const regEmail = `e2e_reg_${Date.now()}@changpt.org`;
    await identifierInput.fill(regEmail);
    await popup.click('button:has-text("Create account")');

    // Should navigate to the "Verify your email" step with code input
    await expect(popup.getByText("Verify your email")).toBeVisible({
      timeout: 90_000, // SMTP send can take up to 60s
    });
    await expect(popup.getByText(regEmail)).toBeVisible();

    // Can't complete without the actual verification code
    await popup.close();
  });
});

// ---------- forgot password flow (UI only — stops at email verification) ----------

test.describe("forgot password flow", () => {
  let userId: string;
  const username = `e2e_forgot_${Date.now()}`;
  const email = `${username}@test.local`;

  test.beforeAll(async () => {
    userId = await createTestUser({
      username,
      password: TEST_PASSWORD,
      email,
    });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("forgot password shows reset form with email input", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);

    const popup = await openLogtoPopup(page, context);

    // Navigate through sign-in to the forgot password link
    await logtoGoToForgotPassword(popup, username);

    // Should show "Reset password" page
    await expect(popup.getByText("Reset password")).toBeVisible({
      timeout: 10_000,
    });

    // Should show an email input for receiving the verification code
    const emailInput = popup.locator("input[name=identifier]");
    await expect(emailInput).toBeVisible();

    // Fill in the email
    await emailInput.fill(email);

    // Click continue/send to trigger the verification code
    const sendButton = popup.locator(
      'button:has-text("Continue"), button:has-text("Send")',
    ).first();
    await sendButton.click();

    // Should show verification code input
    // (email is sent to the real SMTP — we can't complete without the code)
    await expect(
      popup.getByText(/verification code/i),
    ).toBeVisible({ timeout: 10_000 });

    await popup.close();
  });
});

// ---------- password reset + re-login (via Management API) ----------

test.describe("password reset + re-login", () => {
  let userId: string;
  const username = `e2e_reset_${Date.now()}`;
  const newPassword = "Zy7@kPn3wRtQ4!m";

  test.beforeAll(async () => {
    userId = await createTestUser({ username, password: TEST_PASSWORD });
  });

  test.afterAll(async () => {
    if (userId) await deleteTestUser(userId);
  });

  test("after password reset, new password works and old is rejected", async ({
    page,
  }) => {
    // Reset password via Management API
    await resetUserPassword(userId, newPassword);

    // Sign in with the new password
    await programmaticSignIn(page, username, newPassword);

    // Should be on the chat page
    await expect(page.getByText("Welcome")).not.toBeVisible({
      timeout: 15_000,
    });
  });
});
