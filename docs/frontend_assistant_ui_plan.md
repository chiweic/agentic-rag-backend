# Frontend Architecture Plan

## High-Level Direction

We will build the frontend on top of `assistant-ui`.

This means:

1. Web frontend uses `assistant-ui` as the primary UI foundation.
2. Client-side tool rendering will use `tool-ui` where tool visualization is needed.
3. Frontend runtime will be built with `ExternalStoreRuntime`.
4. Thread list behavior will be implemented as a custom thread list owned by the app.
5. Mobile experience should align with `assistant-ui` React Native patterns.

## Core Decisions

### 1. UI Foundation

The web application should use `assistant-ui` primitives and components as the main chat UI layer.

The intent is to:

- reuse `assistant-ui` where it is strong
- avoid inventing a custom chat UI system
- keep visual and interaction patterns aligned with the `assistant-ui` ecosystem

### 2. Runtime Strategy

The frontend runtime should be built around `ExternalStoreRuntime`.

Reasoning:

- frontend needs app-owned state
- thread behavior is likely to be custom
- persistence behavior may be local, backend-backed, or hybrid
- backend contracts may evolve
- the app should not be tightly coupled to one stock transport/runtime integration path too early

`ExternalStoreRuntime` gives us a stable direction for:

- custom thread management
- custom persistence
- controlled synchronization with backend services
- custom state transitions for web and later mobile

### 3. Thread List Strategy

The frontend should use a custom thread list owned by the app.

This means:

- thread list behavior is not assumed to come from a stock runtime integration
- thread storage and thread metadata are app-owned
- sidebar behavior can evolve without being constrained by a stock thread-list contract

The expected direction is:

- `ExternalStoreRuntime` owns active-thread runtime behavior
- a custom thread-list layer owns thread collection state and sidebar behavior
- synchronization with backend thread APIs can be added behind that app-owned layer

This keeps the architecture consistent:

- `Thread` experience can stay close to `assistant-ui`
- thread list behavior can remain product-specific
- frontend state ownership stays explicit

### 4. State Ownership

The frontend should own its state model.

That includes:

- current thread
- thread list
- messages
- streaming state
- UI state around composing, loading, errors, and switching threads

A dedicated state store is likely appropriate. `Zustand` is the most likely candidate, but this is still an implementation choice rather than a final lock-in.

### 5. Tool UI

For client-side tool rendering, the intended direction is to use `tool-ui`.

This should allow:

- consistent tool presentation
- better reuse across web and mobile
- less one-off rendering logic inside thread message components

### 6. Mobile Direction

Mobile should align with `assistant-ui` React Native support.

The goal is not to build mobile immediately, but to avoid a web architecture that blocks reuse later.

That means:

- prefer app-owned runtime/state over web-only transport assumptions
- keep message/thread models portable
- avoid unnecessary coupling to browser-specific runtime patterns

## Immediate Scope

Current implementation focus should be narrow:

1. Build and refine the `Thread` experience first.
2. Keep transport and backend coupling provisional while `Thread` is being stabilized.
3. Add `ThreadListSidebar` after the `Thread` direction is clear.
4. Discuss backend support and sync strategy in parallel, not as a blocker to the first `Thread` work.

## Current Status

Current square-0 baseline is `frontend-v1/`.

It is based on the official `with-external-store` example and is now the active reset point for frontend work.

What is currently true:

- `frontend-v1` uses `useExternalStoreRuntime`
- `frontend-v1` now has a Zustand-backed chat store with explicit thread-list state
- the current focus is `Thread` only
- a first store-backed `ThreadListSidebar` UI pass now exists
- local browser persistence now exists for thread list, messages, and active thread selection
- frontend thread records now include `backendThreadId: string | null`
- frontend thread records now include `syncStatus` and `lastSyncedAt`
- backend requests go directly from the browser to the OpenAI-compatible endpoint at `http://localhost:8081/v1/chat/completions`
- the current call path now uses OpenAI-compatible streaming
- full message history is sent from the frontend-local message state
- sidebar currently supports create, switch, rename, and delete
- local cancel now aborts the in-flight streaming request
- backend thread linkage now occurs on first message send
- backend thread metadata is hydrated from `GET /threads` on app startup
- linked-thread history now loads from `GET /threads/{id}/state`
- linked-thread generation now runs through `POST /threads/{id}/runs/stream`
- rename/delete sync to backend when a linked backend thread exists

What has been verified:

- the frontend can send messages to the backend successfully
- backend logs confirm requests are reaching the server
- the current `Thread` baseline works with the real backend
- tooltip provider issues in the scaffold have already been fixed in `frontend-v1/app/layout.tsx`
- Milestone 3 frontend integration works against the normalized backend thread contract
- backend impact for the current phase is complete; no additional backend work is required for the current frontend integration

## Testing

Frontend verification now includes a minimal Playwright E2E harness in `frontend-v1/tests/e2e/`.

Current automated coverage:

- linked thread metadata rehydrates after page reload
- mixed linked and local-only threads persist across reload without duplicate sidebar entries

Current result:

- Playwright E2E suite passes: 2 passed

Relevant files:

- `frontend-v1/playwright.config.ts`
- `frontend-v1/tests/e2e/thread-hydration.spec.ts`

How to run:

```bash
cd frontend-v1
npx playwright install chromium
npm run test:e2e
```

Notes:

- Playwright starts the local Next app automatically using the config in `frontend-v1/playwright.config.ts`
- the tests assume the backend is already running locally at `http://localhost:8081`
- TypeScript verification for the frontend still uses `npx tsc --noEmit`

What this means:

- `frontend-v1` is the correct baseline for upcoming `Thread` template work
- older experiments in `frontend/` should not be treated as the current architecture baseline
- the current local thread UX slice is complete enough to pause frontend feature work and sync progress with backend

## Non-Goals Right Now

These are not the current priority:

- locking the final backend transport contract
- committing to a stock `assistant-ui` thread-list runtime
- over-designing persistence before the `Thread` UI direction is stable
- optimizing for full feature completeness before the base thread experience is right

## Working Principle

Use `assistant-ui` as the frontend foundation, keep active-thread runtime in `ExternalStoreRuntime`, and implement thread list behavior as an app-owned custom layer.
