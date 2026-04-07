# E2E Test Plan

## Purpose

This document describes the browser-level regression coverage for `frontend-v1`.

The current E2E suite is focused on:

- auth boundary behavior
- thread metadata hydration
- linked-thread history loading
- signed-in vs signed-out routing and API usage

The tests are implemented with Playwright in:

- [`auth-flow.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/auth-flow.spec.ts)
- [`auth-mid-session.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/auth-mid-session.spec.ts)
- [`thread-hydration.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-hydration.spec.ts)
- [`thread-edge.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-edge.spec.ts)
- [`thread-sync-failure.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-sync-failure.spec.ts)
- [`thread-bulk.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-bulk.spec.ts)
- [`streaming-cancel.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/streaming-cancel.spec.ts)
- [`multi-tab.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/multi-tab.spec.ts)
- shared helpers in [`helpers.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/helpers.ts)

## Environment

Frontend test runner:

- Playwright config: [`playwright.config.ts`](/home/chiweic/repository/backend/frontend-v1/playwright.config.ts)
- frontend dev server is auto-started by Playwright on `http://127.0.0.1:3005`

Backend requirement:

- backend must be started manually on `http://localhost:8081`
- run backend with `AUTH_DEV_MODE=true`

Recommended backend command:

```bash
AUTH_DEV_MODE=true uvicorn app.main:app --reload --host 0.0.0.0 --port 8081
```

Recommended frontend test command:

```bash
cd frontend-v1
npm run test:e2e
```

## Test Strategy

The suite intentionally disables Clerk for Playwright and uses the dev-token path instead.

Reason:

- real third-party login is brittle in CI and local automation
- the app already has a test-safe auth path through `POST /auth/dev-token`
- the goal of this suite is product regression coverage, not Clerk vendor UI testing

So the E2E suite validates:

- app auth state transitions
- protected backend access
- thread hydration behavior
- logout/login boundary behavior

without depending on live Google or Clerk UI flows.

## Coverage Structure

The intended structure for this suite is:

1. Happy paths
2. Anonymous-user paths
3. Edge and boundary cases

That means the suite should first protect the main product flows that must always work, then expand into limit and regression coverage.

Recommended grouping:

- happy paths
  - signed-in linked thread flow
  - signed-in thread reload and reopen flow
  - protected Assisted Learning flow
- anonymous paths
  - signed-out local chat baseline
  - signed-out gating for protected pages
- edge and boundary cases
  - auth-boundary thread reopen
  - linked/local coexistence across reload
  - delete persistence
  - long titles
  - large thread counts
  - query/search/filter limits if those features are added

## Current Coverage

### Auth Flow

[`auth-flow.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/auth-flow.spec.ts)

Covered scenarios:

1. Signed-out baseline chat still uses `/v1/chat/completions`
2. Signed-out users are gated from `/assisted-learning`
3. Dev-token sign-in unlocks protected thread flow and Assisted Learning
4. Logout clears linked-thread shells and returns to the signed-out baseline thread

### Mid-Session Auth Failures

[`auth-mid-session.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/auth-mid-session.spec.ts)

Covered scenarios:

1. `401` on next protected action (PATCH rename) signs the user out and wipes linked-thread shells
2. `401` returned by `POST /threads/{id}/runs/stream` mid-run signs the user out and resets chat state

### Thread Sync Failure

[`thread-sync-failure.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-sync-failure.spec.ts)

Covered scenarios:

1. `PATCH` returning 500 keeps the optimistic local title and flips `syncStatus` to `Sync error`; a retry rename after recovery restores `Linked`
2. `DELETE` returning 500 reinserts the deleted thread at its original sidebar index with `syncStatus` `Sync error`

### Streaming Cancellation

[`streaming-cancel.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/streaming-cancel.spec.ts)

Covered scenarios:

1. Clicking "Stop generating" mid-run returns the composer to the idle state, preserves the user message locally, and allows a follow-up send

Documents a known backend behavior: LangGraph's `astream_events` does not currently propagate client disconnects, so the server continues generation after the client aborts. The test does not depend on this.

### Bulk Thread Hydration

[`thread-bulk.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-bulk.spec.ts)

Covered scenarios:

1. 50 linked threads seeded via direct API calls hydrate via `GET /threads` within a 5 s latency budget, render exactly once in the sidebar, and come back in newest-first order.

This test depends on the `list_threads` title-fallback cleanup — title backfill is now done at run time in `POST /threads/{id}/runs/stream`, so `GET /threads` is a single indexed DB query with no per-thread checkpoint read.

### Multi-Tab

[`multi-tab.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/multi-tab.spec.ts)

Covered scenarios:

1. A backend-linked thread created in tab A is visible in tab B after tab B signs in independently, via backend-as-source-of-truth hydration
2. Tab B clearing `sessionStorage` and reloading does not affect tab A's session (per-tab auth isolation verified)

What this protects:

- signed-out local chat remains functional
- protected pages stay gated while signed out
- signed-in users hit `/threads*` instead of `/v1/chat/completions`
- logout clears auth-boundary state instead of leaking linked-thread UI

Current assessment:

- user auth coverage is already in good shape for the current milestone
- future E2E expansion should spend more time on thread/product edge cases than on basic auth repetition

### Thread Hydration

[`thread-hydration.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-hydration.spec.ts)

Covered scenarios:

1. Backend-linked thread metadata rehydrates after reload
2. Linked and local-only threads coexist across reload without duplication
3. Reopened linked thread loads history after logout and login without sending a new message
4. Deleted linked thread stays deleted after reload and re-login

What this protects:

- backend metadata hydration does not duplicate rows
- local-only thread behavior is preserved
- linked-thread history lazy-loading works after auth-boundary resets
- delete persistence works across reload and auth transitions

## Known Lessons Captured In Tests

The suite was expanded after a real regression where:

- a linked thread existed before logout
- user logged out and logged back in
- clicking the previous thread showed `Loading history`
- history did not appear until a new message was sent

That regression is now covered directly.

This is important because simpler reload-only tests did not catch it.

## Known Accepted Behavior

Current backend-linked thread rows may briefly show:

- `0 messages Linked`

after login or reload until the user opens the thread.

Why:

- `GET /threads` hydrates metadata only
- full history is loaded lazily from `GET /threads/{id}/state`
- sidebar message count is derived from locally cached messages

This is currently accepted because the production UI is expected to hide that status line.

## Stability Rules For New E2E Tests

When adding tests, prefer:

- waiting for concrete backend responses rather than generic UI timing
- stable `data-testid` selectors where interactions are repeated
- explicit auth setup through the shared helpers
- assertions on user-visible outcome first, request shape second

Avoid:

- relying on optimistic UI timing alone
- broad text selectors when rows contain repeated labels like `Linked`
- real Google or Clerk automation in Playwright
- helper functions that hide the real event a test should wait for

## Current Gaps

Not yet covered in Playwright:

- assisted-learning error states
- Clerk production-path UI itself
- any future sidebar search/filter/query constraints

Recently closed:

- rename/delete failure handling and rollback visuals → `thread-sync-failure.spec.ts`
- backend `401` handling mid-session (next action, mid run/stream) → `auth-mid-session.spec.ts`
- cancellation behavior during linked-thread streaming → `streaming-cancel.spec.ts`
- multi-tab auth/thread behavior → `multi-tab.spec.ts`
- high-count thread list behavior → `thread-bulk.spec.ts`
- extreme thread title/query length behavior → `thread-edge.spec.ts`

## Next Expansion Priorities

Based on current coverage, the next best E2E additions are:

1. Assisted Learning fetch failure states (500, network error) — gate-verification UX on failure
2. Backend behavior follow-ups surfaced by new tests:
   - LangGraph `astream_events` client-disconnect handling (server-side cancellation wiring)
   - `reconcileBackendThreads` pruning semantics (local-only state that no longer exists server-side)
3. Search/filter behavior once sidebar search is added
4. Clerk production-path smoke (low priority — vendor UI territory)

These are reasonable next candidates if we want to expand coverage further.

## Maintenance Notes

If a thread/auth bug is found manually, prefer:

1. reduce it to a reproducible user sequence
2. add or update a focused Playwright regression
3. fix the product logic
4. keep the new regression permanently

That is the standard we want going forward, because several earlier issues were only discoverable once the exact auth-boundary sequence was exercised.
