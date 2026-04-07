import { expect, test } from "@playwright/test";
import { clearBrowserState, signInWithDevToken } from "./helpers";

const BACKEND_BASE_URL =
  process.env.NEXT_PUBLIC_BACKEND_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:7081";
const BULK_COUNT = 50;
const HYDRATION_BUDGET_MS = 5_000;

test.beforeEach(async ({ page }) => {
  await clearBrowserState(page);
});

// Seed a large number of backend-linked threads via direct API calls and
// verify the frontend hydrates them correctly on reload. Also asserts that
// GET /threads returns within a reasonable latency budget after the
// list_threads fallback fix (title backfill at run time, no per-thread
// checkpoint read in GET /threads).
test("hydrates a large number of backend-linked threads on reload", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const runId = Date.now();
  const titlePrefix = `bulk-thread-${runId}`;

  // Mint a dev token for seeding (shares the same sub used by the UI login
  // button so that the reloaded UI can see the seeded threads).
  const tokenResponse = await request.post(
    `${BACKEND_BASE_URL}/auth/dev-token`,
    {
      data: {
        sub: "playwright-user",
        email: "playwright@example.com",
        name: "Playwright User",
        ttl_seconds: 3600,
      },
    },
  );
  expect(tokenResponse.ok()).toBeTruthy();
  const { access_token: token } = (await tokenResponse.json()) as {
    access_token: string;
  };

  // Seed BULK_COUNT backend threads with titles. Titles are what the sidebar
  // renders, so setting them avoids depending on runs/state.
  const seededTitles: string[] = [];
  for (let i = 0; i < BULK_COUNT; i++) {
    const createResponse = await request.post(`${BACKEND_BASE_URL}/threads`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });
    expect(createResponse.ok()).toBeTruthy();
    const { thread_id: threadId } = (await createResponse.json()) as {
      thread_id: string;
    };

    const title = `${titlePrefix}-${String(i).padStart(3, "0")}`;
    const patchResponse = await request.patch(
      `${BACKEND_BASE_URL}/threads/${threadId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { title },
      },
    );
    expect(patchResponse.ok()).toBeTruthy();
    seededTitles.push(title);
  }

  // Time GET /threads against the current budget. After the title-fallback
  // cleanup this is a single indexed DB query with no per-thread state reads.
  const listStart = Date.now();
  const listResponse = await request.get(`${BACKEND_BASE_URL}/threads`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listElapsedMs = Date.now() - listStart;
  expect(listResponse.ok()).toBeTruthy();
  const listed = (await listResponse.json()) as Array<{
    thread_id: string;
    title: string | null;
  }>;
  expect(listed.length).toBeGreaterThanOrEqual(BULK_COUNT);
  expect(listElapsedMs).toBeLessThan(HYDRATION_BUDGET_MS);

  // Backend is sorted newest-first; we seeded oldest-first, so index 0 of
  // `listed` should be the highest-numbered seeded title.
  const seededInListOrder = listed
    .map((t) => t.title)
    .filter(
      (t): t is string =>
        typeof t === "string" && t.startsWith(`${titlePrefix}-`),
    );
  const expectedNewestFirst = [...seededTitles].reverse();
  expect(seededInListOrder).toEqual(expectedNewestFirst);

  // Sign in via UI — this causes the frontend to hit GET /threads on hydration.
  const listRequestPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/threads$/.test(response.url()) &&
      response.ok(),
  );
  await signInWithDevToken(page);
  await listRequestPromise;

  // Sidebar should render every seeded thread exactly once.
  const threadItems = page.locator('[data-testid="thread-item"]');
  await expect
    .poll(async () => await threadItems.count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(BULK_COUNT);

  // Assert no duplicates for a sampled set of seeded titles (first, middle,
  // last). Full-set duplicate checks on 50 rows are slow and noisy.
  for (const idx of [0, Math.floor(BULK_COUNT / 2), BULK_COUNT - 1]) {
    const title = seededTitles[idx];
    await expect(
      threadItems.filter({ has: page.getByText(title, { exact: true }) }),
    ).toHaveCount(1);
  }
});
