import type { Page, BrowserContext } from "@playwright/test";

const BACKEND_BASE = process.env.BACKEND_BASE ?? "http://localhost:7081";
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
  // Always provide an email — Logto sign-in experience requires it
  body.primaryEmail = opts.email ?? `${opts.username}@test.local`;

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

// ─── Programmatic sign-in (bypasses popup) ───────────────────────────

const LOGTO_APP_ID = process.env.LOGTO_APP_ID ?? "5mcfcvqvthf80j40vw0na";
const LOGTO_RESOURCE = "https://api.myapp.local";

/**
 * Sign in programmatically by completing the OIDC flow via API,
 * then injecting the resulting tokens into the Logto BrowserStorage.
 *
 * This bypasses the popup flow which is unreliable in Playwright.
 */
export async function programmaticSignIn(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  // Step 1: Start OIDC auth flow
  const redirectUri = "http://localhost:8081/callback";
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString();
  const nonce = generateRandomString();

  const authUrl = new URL(`${LOGTO_BASE}/oidc/auth`);
  authUrl.searchParams.set("client_id", LOGTO_APP_ID);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid offline_access profile");
  authUrl.searchParams.set("resource", LOGTO_RESOURCE);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("prompt", "login");

  // Helper to accumulate cookies across responses (like a cookie jar)
  const cookieJar = new Map<string, string>();
  function collectCookies(resp: Response) {
    const setCookies = resp.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const nameVal = sc.split(";")[0]; // "name=value"
      const eqIdx = nameVal.indexOf("=");
      if (eqIdx > 0) {
        cookieJar.set(nameVal.slice(0, eqIdx), nameVal);
      }
    }
  }
  function getCookieHeader() {
    return [...cookieJar.values()].join("; ");
  }

  // Get the interaction cookies
  const authResp = await fetch(authUrl.toString(), { redirect: "manual" });
  collectCookies(authResp);

  // Step 2: Submit credentials via Experience API (v2 verification-based flow)
  // PUT /api/experience — start interaction
  const expResp = await fetch(`${LOGTO_BASE}/api/experience`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: getCookieHeader(),
    },
    body: JSON.stringify({ interactionEvent: "SignIn" }),
  });
  collectCookies(expResp);

  // POST /api/experience/verification/password — verify credentials
  const verifyResp = await fetch(
    `${LOGTO_BASE}/api/experience/verification/password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: getCookieHeader(),
      },
      body: JSON.stringify({
        identifier: {
          type: username.includes("@") ? "email" : "username",
          value: username,
        },
        password,
      }),
    },
  );
  collectCookies(verifyResp);
  if (!verifyResp.ok) {
    const text = await verifyResp.text();
    throw new Error(`Password verification failed: ${verifyResp.status} ${text}`);
  }
  const { verificationId } = await verifyResp.json();

  // POST /api/experience/identification — identify with verificationId
  const identResp = await fetch(
    `${LOGTO_BASE}/api/experience/identification`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: getCookieHeader(),
      },
      body: JSON.stringify({ verificationId }),
    },
  );
  collectCookies(identResp);
  if (!identResp.ok) {
    const text = await identResp.text();
    throw new Error(`Identification failed: ${identResp.status} ${text}`);
  }

  // POST /api/experience/submit — submit the interaction
  const submitResp = await fetch(`${LOGTO_BASE}/api/experience/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: getCookieHeader(),
    },
    body: JSON.stringify({}),
  });
  collectCookies(submitResp);
  if (!submitResp.ok) {
    const text = await submitResp.text();
    throw new Error(`Submit failed: ${submitResp.status} ${text}`);
  }
  const submitData = await submitResp.json();

  // Follow redirect chain: redirectTo → consent → oidc/auth → callback?code=...
  let location = submitData.redirectTo ?? "";
  for (let i = 0; i < 10 && location && !location.includes("code="); i++) {
    const url = location.startsWith("/")
      ? `${LOGTO_BASE}${location}`
      : location;
    const resp = await fetch(url, {
      redirect: "manual",
      headers: { Cookie: getCookieHeader() },
    });
    collectCookies(resp);
    location = resp.headers.get("location") ?? "";
  }

  // Extract auth code from the final redirect URL
  if (!location.includes("code=")) {
    throw new Error(`No auth code in redirect chain: ${location}`);
  }
  const callbackUrl = new URL(location);
  const code = callbackUrl.searchParams.get("code");
  if (!code) {
    throw new Error(`No auth code in redirect: ${location}`);
  }

  // Step 3: Exchange code for tokens
  const tokenResp = await fetch(`${LOGTO_BASE}/oidc/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: LOGTO_APP_ID,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenResp.ok) {
    const text = await tokenResp.text();
    throw new Error(`Token exchange failed: ${tokenResp.status} ${text}`);
  }
  const tokens = await tokenResp.json();

  // Step 4: Inject tokens into Logto BrowserStorage via page.evaluate
  await page.goto("/");
  await page.evaluate(
    ({ appId, tokens: t, resource }) => {
      const prefix = `logto:${appId}`;
      // Store the ID token
      if (t.id_token) {
        localStorage.setItem(`${prefix}:idToken`, t.id_token);
      }
      // Store the refresh token
      if (t.refresh_token) {
        localStorage.setItem(`${prefix}:refreshToken`, t.refresh_token);
      }
      // Store the access token (keyed by resource)
      if (t.access_token) {
        const tokenMap = {
          [resource]: {
            token: t.access_token,
            expiresAt: Math.floor(Date.now() / 1000) + (t.expires_in ?? 3600),
            scope: t.scope ?? "",
          },
        };
        localStorage.setItem(`${prefix}:accessToken`, JSON.stringify(tokenMap));
      }
    },
    { appId: LOGTO_APP_ID, tokens, resource: LOGTO_RESOURCE },
  );

  // Reload so the Logto client picks up the stored tokens
  await page.reload();
  await page.waitForTimeout(3000);
}

function generateRandomString(length = 43): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function generateCodeVerifier(): string {
  return generateRandomString(43);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ─── Backend helpers (dev-token auth) ────────────────────────────────

/** Mint a dev JWT for the given sub (requires AUTH_DEV_MODE=true). */
export async function getDevToken(sub: string): Promise<string> {
  const res = await fetch(`${BACKEND_BASE}/auth/dev-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sub, email: `${sub}@test.local` }),
  });
  if (!res.ok) throw new Error(`Dev token failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

/** Create a backend thread (returns thread_id). */
export async function createBackendThread(token: string): Promise<string> {
  const res = await fetch(`${BACKEND_BASE}/threads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Create thread failed: ${res.status}`);
  const data = await res.json();
  return data.thread_id;
}

/** Send a message to a thread and wait for the stream to finish. */
export async function sendBackendMessage(
  token: string,
  threadId: string,
  message: string,
): Promise<void> {
  const res = await fetch(
    `${BACKEND_BASE}/threads/${threadId}/runs/stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        input: { messages: [{ role: "user", content: message }] },
      }),
    },
  );
  if (!res.ok) throw new Error(`Stream run failed: ${res.status}`);
  // Consume the entire stream
  await res.text();
}

/** List backend threads for a user. */
export async function listBackendThreads(
  token: string,
): Promise<Array<{ thread_id: string; title?: string; is_archived?: boolean }>> {
  const res = await fetch(`${BACKEND_BASE}/threads`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`List threads failed: ${res.status}`);
  return res.json();
}

/** Delete a backend thread. */
export async function deleteBackendThread(
  token: string,
  threadId: string,
): Promise<void> {
  await fetch(`${BACKEND_BASE}/threads/${threadId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}
