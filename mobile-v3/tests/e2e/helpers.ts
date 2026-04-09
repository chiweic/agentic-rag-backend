import type { Page, BrowserContext } from "@playwright/test";

const LOGTO_BASE = process.env.LOGTO_BASE ?? "http://localhost:3302";
const M2M_APP_ID = process.env.M2M_APP_ID ?? "1rpxrlk0wm7i4zcgnqv1n";
const M2M_APP_SECRET =
  process.env.M2M_APP_SECRET ?? "erD64MpUIGepSgE4Jx1c8ZQLlMsiTwZl";

let cachedM2mToken: { token: string; expiresAt: number } | null = null;

/** Get an M2M access token for the Logto Management API. */
export async function getM2mToken(): Promise<string> {
  if (cachedM2mToken && Date.now() < cachedM2mToken.expiresAt) {
    return cachedM2mToken.token;
  }

  const res = await fetch(`${LOGTO_BASE}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: M2M_APP_ID,
      client_secret: M2M_APP_SECRET,
      resource: "https://default.logto.app/api",
      scope: "all",
    }),
  });
  if (!res.ok) throw new Error(`M2M token failed: ${res.status}`);
  const data = await res.json();
  cachedM2mToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}

/** Create a test user via Management API. Returns user ID. */
export async function createTestUser(opts: {
  username: string;
  password: string;
  email?: string;
}): Promise<string> {
  const token = await getM2mToken();
  const body: Record<string, string> = {
    username: opts.username,
    password: opts.password,
  };
  if (opts.email) body.primaryEmail = opts.email;

  const res = await fetch(`${LOGTO_BASE}/api/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Create user failed: ${res.status} ${text}`);
  }
  const user = await res.json();
  return user.id;
}

/** Delete a test user via Management API. */
export async function deleteTestUser(userId: string): Promise<void> {
  const token = await getM2mToken();
  await fetch(`${LOGTO_BASE}/api/users/${userId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Reset user password via Management API. */
export async function resetUserPassword(
  userId: string,
  newPassword: string,
): Promise<void> {
  const token = await getM2mToken();
  const res = await fetch(`${LOGTO_BASE}/api/users/${userId}/password`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!res.ok) throw new Error(`Reset password failed: ${res.status}`);
}

/**
 * Click the "Sign In" button on the app and return the Logto popup page.
 * The app must be on the sign-in screen.
 */
export async function openLogtoPopup(
  page: Page,
  context: BrowserContext,
): Promise<Page> {
  const popupPromise = context.waitForEvent("page", { timeout: 15_000 });
  await page.getByText("Sign In", { exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("networkidle");
  return popup;
}

/**
 * Fill the Logto sign-in form (identifier → password → submit).
 * The popup must be on the Logto sign-in page.
 * After success, the popup closes and the app redirects to the chat page.
 */
export async function logtoSignIn(
  popup: Page,
  identifier: string,
  password: string,
): Promise<void> {
  // Step 1: Enter identifier (username or email)
  await popup.fill("input[name=identifier]", identifier);
  await popup.click('button:has-text("Sign in")');

  // Step 2: Enter password
  const passwordInput = popup.locator("input[type=password]");
  await passwordInput.waitFor({ state: "visible", timeout: 10_000 });
  await passwordInput.fill(password);

  // Step 3: Submit
  await popup.click('button:has-text("Continue")');
}

/**
 * Navigate to the Logto registration page from the sign-in popup.
 */
export async function logtoGoToRegister(popup: Page): Promise<void> {
  await popup.click('a:has-text("Create account")');
  await popup.waitForLoadState("networkidle");
}

/**
 * Navigate to the Logto forgot-password page from the password step.
 * Must call after entering identifier on the sign-in page.
 */
export async function logtoGoToForgotPassword(
  popup: Page,
  identifier: string,
): Promise<void> {
  // First enter identifier to get to password step
  await popup.fill("input[name=identifier]", identifier);
  await popup.click('button:has-text("Sign in")');

  // Wait for password step, then click forgot password
  await popup.locator("input[type=password]").waitFor({
    state: "visible",
    timeout: 10_000,
  });
  await popup.click('a:has-text("Forgot your password")');
}
