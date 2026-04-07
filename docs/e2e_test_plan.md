# E2E Test Plan

## Purpose

This document defines the intended browser-level E2E strategy for [`frontend-v1`](/home/chiweic/repository/backend/frontend-v1).

The main lesson from recent maintenance work is that the suite should protect
stable product contracts, not the current UI layout. As the web interface keeps
evolving, tests that depend on exact sidebar composition, button placement, or
specific interaction choreography become expensive and noisy.

So the E2E suite should answer:

- can a user ask a question and get an answer?
- do signed-in threads behave correctly?
- do rename/delete/logout boundaries preserve the right data invariants?
- does streaming visibly start?
- do important thread-list features still work?

It should avoid overfitting to:

- exact placement of controls
- exact sidebar visual structure
- specific local choreography that is likely to change in later UI cycles

## Framework Decision

The web E2E framework remains Playwright.

Reason:

- it is a good fit for full browser flows
- it supports network assertions well
- it is appropriate for auth, reload, hydration, and multi-tab behavior
- the current maintenance issue is not Playwright itself, but the level of
  abstraction used by some existing tests

So the strategy is:

- keep Playwright
- reduce brittle UI-coupled assertions
- reorganize coverage by criticality and contract level

## Environment

Frontend test runner:

- Playwright config: [`frontend-v1/playwright.config.ts`](/home/chiweic/repository/backend/frontend-v1/playwright.config.ts)
- frontend dev server is started by Playwright on `http://127.0.0.1:3005`

Backend requirement:

- backend should be started manually on `http://127.0.0.1:7081`
- backend should run with `AUTH_DEV_MODE=true`

Recommended backend command:

```bash
cd /home/chiweic/repository/backend
AUTH_DEV_MODE=true ./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 7081
```

Recommended frontend E2E command:

```bash
cd /home/chiweic/repository/backend/frontend-v1
npm run test:e2e
```

## Auth Strategy

For Playwright, the suite intentionally uses the dev-token auth path rather than
real Clerk UI.

Reason:

- vendor login UI is not the product contract we need to regression-test here
- real third-party auth is brittle in local automation and CI
- the purpose of this suite is to verify product behavior after auth state is set

So the suite should validate:

- signed-out behavior
- signed-in behavior
- auth-boundary resets
- protected backend access

without treating Clerk-hosted UI as the core automation target.

## Test Tiers

The E2E suite should be reorganized into three tiers:

1. `Core`
2. `Features`
3. `Add-ons`

This is the primary organizing principle.

The goal is:

- `Core` must pass and should be release-gating
- `Features` should pass and protect important product flows
- `Add-ons` are useful, but must not dominate maintenance time

## Core

`Core` tests protect the minimum browser contracts that must work.

These should stay few, stable, and strongly product-oriented.

Target coverage:

- app boots successfully
- signed-out basic thread flow works
- user can send a query and receive an answer
- signed-in linked-thread flow works
- thread rename works
- thread delete works
- logout resets auth-bound state correctly
- streaming visibly starts for a long answer
  - first token / first partial response appears

Recommended examples for `Core`:

- anonymous query/answer path
- signed-in linked-thread query/answer path
- rename active thread
- delete linked thread
- logout returns app to signed-out baseline
- long-answer streaming begins with visible partial output

These tests should prefer assertions like:

- answer appears
- thread exists or no longer exists
- auth state changes from signed-in to anonymous
- request path uses `/threads/.../runs/stream` instead of `/v1/chat/completions`
- first streamed token becomes visible

They should avoid assertions like:

- exact lower-left placement of account control
- exact sidebar card markup
- exact button alignment inside a row

## Features

`Features` tests protect important user-facing behavior beyond the minimal gate.

These are still valuable, but they are not the absolute must-pass baseline.

Target coverage:

- thread-list hydration
- create thread
- remove thread
- thread switching
- linked and local-only coexistence
- reload persistence
- protected page gating
- backend sync failure UX for rename/delete
- multi-tab behavior, if we decide it remains product-relevant

Recommended examples for `Features`:

- linked thread appears after sign-in hydration
- switching between threads changes active conversation
- local-only and linked threads coexist without duplication
- reload preserves expected thread state
- protected route is gated when signed out
- rename failure preserves optimistic title and shows a sync error
- delete failure restores the thread and shows a sync error

These tests should still use durable product semantics, but they may accept
more runtime complexity than `Core`.

## Add-ons

`Add-ons` are useful but non-blocking.

They are the first candidates to quarantine, run separately, or mark as
lower-priority if they become expensive to maintain.

Target coverage:

- very long queries
- very long answers
- bulk hydration and large thread counts
- cancellation edge cases
- unusual persisted-state scenarios
- heavier endurance and scale behavior

Recommended examples for `Add-ons`:

- long query / long answer endurance
- very large thread-list hydration
- cancellation during streaming
- invalid persisted auth/token edge case
- multi-step recovery edge cases after unusual state corruption

These should not block everyday development if they become flaky or slow.

## Current Test Inventory Mapping

The existing Playwright files should be reinterpreted through the new tier model.

Probable mapping:

- `Core`
  - selected coverage from [`auth-flow.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/auth-flow.spec.ts)
  - selected coverage from [`thread-edge.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-edge.spec.ts)
  - a trimmed streaming assertion from [`streaming-cancel.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/streaming-cancel.spec.ts) or a dedicated simpler streaming spec

- `Features`
  - selected coverage from [`thread-hydration.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-hydration.spec.ts)
  - selected coverage from [`thread-sync-failure.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-sync-failure.spec.ts)
  - selected coverage from [`auth-mid-session.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/auth-mid-session.spec.ts)
  - selected coverage from [`multi-tab.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/multi-tab.spec.ts)

- `Add-ons`
  - [`thread-bulk.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-bulk.spec.ts)
  - long-title / endurance style cases from [`thread-edge.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/thread-edge.spec.ts)
  - richer cancellation behavior from [`streaming-cancel.spec.ts`](/home/chiweic/repository/backend/frontend-v1/tests/e2e/streaming-cancel.spec.ts)

This mapping is directional, not final. The important decision is the tiering,
not the exact current filenames.

## Authoring Rules

When writing or rewriting E2E tests, prefer:

- stable `data-testid` contracts that represent domain intent
- assertions on durable user outcomes
- assertions on meaningful request classes when needed
- explicit auth setup through helpers
- fewer, simpler helpers

Good examples of durable test intent:

- `thread-create-button`
- `thread-rename-action`
- `thread-delete-action`
- `auth-logout-action`
- `thread-sync-status`

Avoid:

- helpers that assume exact visual placement
- global waits based on incidental UI state
- exact layout assertions unless layout itself is the feature under test
- turning every sidebar interaction into a high-value E2E concern

## Stability Guidance

The suite should be biased toward:

- product contracts
- data invariants
- auth boundaries
- request-path verification where meaningful

The suite should be biased away from:

- pixel-level behavior
- exact component choreography
- implementation-detail selectors
- timing assumptions based on current UI composition

If a test is repeatedly expensive because the UI is evolving, ask:

- is this still a `Core` contract?
- is it really a `Features` contract?
- should it become an `Add-on` or be removed?

## CI Implication

The tier model should eventually map into CI execution policy:

- `Core`: always run, must pass
- `Features`: run regularly, but may be a separate required job
- `Add-ons`: optional, scheduled, or explicitly non-blocking

This is important because maintenance cost is now part of the design.
The suite should not be allowed to grow as one flat required block.

## Immediate Direction

The next maintenance step for web E2E should be:

1. classify current Playwright tests into `Core`, `Features`, and `Add-ons`
2. reduce `Core` to a small contract suite
3. rewrite brittle tests around durable selectors and product outcomes
4. demote or quarantine long and layout-sensitive cases when they are not
   release-critical

That is the agreed direction for the next E2E cleanup cycle.
