# Frontend Architecture Plan

## Overview

This document describes the phased frontend architecture for the assistant-ui chat application. The current `frontend/` directory is the only frontend; it was originally authored as `frontend-v2/` to replace the legacy `frontend-v1/` (now removed) without migration — no legacy code was carried over.

The backend provides LangGraph-compatible thread endpoints at `/threads`. These remain stable across all phases.

## Decisions

- **Runtime**: `useLangGraphRuntime` — connects directly to backend `/threads` endpoints, no middleware needed
- **No Vercel AI SDK**: the backend already speaks LangGraph protocol; adding AI SDK would be an extra dependency with no clear job
- **No Zustand**: the runtime is the state layer — it owns messages, thread switching, streaming status
- **No AssistantCloud for threads**: backend already has thread persistence in Postgres via LangGraph checkpointer
- **Fresh codebase**: `frontend/` directory, clean start (historical `frontend-v1/` has been removed; no migration path)
- **Phases 1 and 2 collapse**: since `useLangGraphRuntime` talks directly to our backend, thread persistence is self-hosted from day one. Phase 2 is only the auth swap.

## Historical State (`frontend-v1`, removed)

The legacy `frontend-v1/` used:

- `useExternalStoreRuntime` with a custom Zustand store layer
- `chat-store.ts` (444 lines) — thread/message state, sync logic
- `auth-store.ts` (203 lines) — multi-provider auth state
- `backend-threads.ts` (246 lines) — backend API client for threads
- `MyRuntimeProvider.tsx` (566 lines) — runtime wiring, message conversion, polling

Total custom runtime code: ~1,400 lines. All of it replaced by `useLangGraphRuntime` in the current `frontend/` codebase. The `frontend-v1/` directory itself was removed on 2026-04-19.

## Phase 1 — ChatGPT Experience

### Goal

Ship a multi-user chat experience with threads, thread list, and streaming in `frontend`.

### Tech Stack

| Layer          | Choice                                                  |
|----------------|---------------------------------------------------------|
| Runtime        | `useLangGraphRuntime` + `useRemoteThreadListRuntime`    |
| Thread storage | Backend Postgres (LangGraph checkpointer + thread_store)|
| Auth           | Clerk (for fast MVP)                                    |
| UI components  | assistant-ui React components                           |
| Framework      | Next.js                                                 |

### Architecture

```
Browser
  └── assistant-ui components
        └── useRemoteThreadListRuntime
              └── useLangGraphRuntime
                    ├── Thread list:  GET    /threads
                    ├── Thread state: GET    /threads/{id}/state
                    ├── Streaming:    POST   /threads/{id}/runs/stream (SSE)
                    └── Create:       POST   /threads

Thread persistence: Postgres (backend LangGraph checkpointer + thread_store.py)
Auth: Clerk (JWT attached to runtime fetch calls)
```

### What Gets Built (`frontend`)

- Runtime provider (~50 lines) — `useLangGraphRuntime` + `useRemoteThreadListRuntime` config
- Clerk auth integration — `useAuth` hook, JWT in fetch headers
- assistant-ui component wiring — `Thread`, `ThreadList`, `Composer`, `AssistantMessage`
- Minimal Next.js app shell with Clerk provider

### Features Delivered

- Thread creation, listing, switching, deletion
- Streaming chat with SSE
- Multi-user isolation via Clerk user ID
- Conversation history persisted in backend Postgres
- LangGraph features available: tool calls, structured output display

## Phase 2 — Self-Hosted Auth (No UI Change)

### Goal

Replace Clerk with self-hosted auth. No user-facing UI changes.

### What Changes

| Component      | From           | To                           |
|----------------|----------------|------------------------------|
| Auth           | Clerk          | Auth.js or Logto OSS         |
| Backend OIDC   | Clerk provider | New provider entry in auth.py |

### What Stays the Same

- Runtime — unchanged
- UI components — unchanged
- Thread storage — unchanged (already self-hosted)
- Backend endpoints — unchanged

### Migration Steps

1. Set up Auth.js or Logto OSS (self-hosted OIDC)
2. Replace Clerk provider/hooks in `frontend` with new auth provider
3. Add new OIDC provider config to backend `app/core/auth.py`
4. Remove Clerk dependency

## Phase 3 — Mobile

### Goal

Deliver a mobile chat experience that shares the same backend and thread endpoints.

### Recommended Stack

| Layer          | Choice                                       |
|----------------|----------------------------------------------|
| Framework      | React Native + Expo Router                   |
| AI SDK         | Vercel AI SDK (`useChat` from `ai/react`)    |
| Backend        | Same FastAPI `/v1/chat/completions`          |
| Auth           | Auth.js/Logto with mobile PKCE flow          |
| UI             | Custom React Native components               |

### Why Vercel AI SDK Here (But Not Web)

On web, `useLangGraphRuntime` connects directly to backend thread endpoints — no SDK needed. On mobile, there's no assistant-ui runtime available yet. Vercel AI SDK's `useChat` provides:

- Streaming state management with no DOM dependency
- Works in React Native today
- Talks to `/v1/chat/completions` (backend already serves this)

If assistant-ui ships React Native support later, `useChat` can be swapped out.

### Architecture

```
Mobile App (Expo)
  └── Custom RN chat UI
        └── useChat (Vercel AI SDK)
              └── FastAPI /v1/chat/completions (SSE)

Thread persistence: Backend /threads endpoints (same as web)
Auth: Auth.js/Logto (PKCE flow for mobile)
```

### Considerations

- Build native-feeling chat UI components (message bubbles, input bar, thread list)
- Share thread endpoints with web — user sees same conversations on both platforms
- SSE streaming works in React Native via polyfill or `EventSource` package
- Push notifications can be added independently of the chat architecture

## Backend Stability

The backend requires no changes for Phase 1 or 3. Phase 2 only adds a new OIDC provider entry.

| Endpoint                        | Used By          |
|---------------------------------|------------------|
| `POST /threads`                 | Web (Phase 1+)   |
| `GET /threads`                  | Web (Phase 1+)   |
| `GET /threads/{id}/state`       | Web (Phase 1+)   |
| `POST /threads/{id}/runs/stream`| Web (Phase 1+)   |
| `/v1/chat/completions`          | Mobile (Phase 3) |
| `app/core/auth.py`              | New OIDC provider in Phase 2 |

## Testing Strategy

```
Testing Pyramid
│
├── Unit Tests (Vitest)
│   ├── Utility functions
│   ├── Auth header construction
│   └── Runtime configuration
│
├── Integration Tests (Vitest + MSW)
│   ├── LangGraph runtime ↔ backend /threads endpoints
│   ├── Streaming SSE response handling
│   └── Auth token refresh / 401 handling
│
├── Component Tests (React Testing Library)
│   ├── Chat UI interactions (send, streaming display)
│   ├── ThreadList rendering (create, switch, delete)
│   └── Auth-gated pages (signed in vs signed out)
│
└── E2E Tests (Playwright)
    ├── Sign in flow (Clerk → Auth.js/Logto in Phase 2)
    ├── Send message + streaming response
    ├── Create / switch / delete thread
    └── Multi-user thread isolation
```

### Local Gates (must pass before commit)

- `tsc --noEmit` — typecheck
- `biome check .` — lint
- `vitest run` — unit + integration + component tests

### CI (GitHub Actions on `frontend/**`)

- Typecheck, lint, test — three parallel jobs
- E2E not a commit gate until suite is stable

### Pre-commit Hooks

- Biome check on staged `frontend` files

## Timeline Dependencies

| Phase | Depends On                                  |
|-------|---------------------------------------------|
| 1     | Nothing — can start immediately             |
| 2     | Phase 1 complete, auth provider selected    |
| 3     | Phase 2 complete (self-hosted auth for mobile PKCE) |
