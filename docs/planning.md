# Shared Planning

## Current Milestone Status

Milestone 3 frontend integration is now implemented and verified, and backend is aligned.

Implemented and verified:

- frontend uses `assistant-ui`
- active thread runtime uses `ExternalStoreRuntime`
- frontend state is app-owned via Zustand
- thread list is app-owned and local
- local persistence is handled with `zustand/persist`
- chat transport uses `/v1/chat/completions`
- transport is stateless and currently uses `stream: true`
- frontend parses OpenAI SSE delta responses
- local cancel aborts the in-flight streaming request
- backend thread linkage is created on first message send
- linked thread metadata is hydrated from `GET /threads` on app startup
- linked thread rename syncs to `PATCH /threads/{id}`
- linked thread delete syncs to `DELETE /threads/{id}`
- backend-linked threads can be rehydrated locally without changing the generation path
- linked-thread history loads from `GET /threads/{id}/state`
- linked-thread generation runs through `POST /threads/{id}/runs/stream`
- `/v1/chat/completions` remains only for local-only/unlinked fallback before linkage
- linked-thread partial streaming uses replace-each-tick semantics from normalized `messages/partial`
- pre-send local thread titles are persisted to backend on first linkage
- backend reconciliation is gated on Zustand hydration to avoid duplicate shells and title clobbering
- Playwright E2E suite passes for the current frontend Milestone 3 coverage: `2 passed`

Backend impact for the completed milestone:

- none beyond the already-landed Milestone 3 contract work
- no additional backend changes are required for the current frontend integration

## Completed Milestone Details

### Goal

Introduce backend-linked thread identities and backend-backed thread metadata synchronization without replacing the current frontend architecture.

### Scope

Keep these as-is:

- `assistant-ui` UI foundation
- `ExternalStoreRuntime`
- Zustand as the app-owned state layer
- current sidebar UX and local-first interaction model
- `/v1/chat/completions` as the active generation path for now

Added:

- backend thread ID on frontend thread records
- `syncStatus` and `lastSyncedAt` on frontend thread records
- thread metadata hydration from `GET /threads`
- thread metadata sync between frontend thread list and backend thread endpoints
- a clear local-to-backend mapping strategy for thread lifecycle

### Outcome

After this milestone:

- each frontend thread can have a linked backend thread identity
- frontend thread metadata can be synchronized with backend state
- backend-linked threads can be reconstructed locally from backend metadata alone
- current local UX remains intact
- backend is now the durable source of truth for linked thread metadata

### Explicit Non-Goals

Not part of this milestone:

- replacing `ExternalStoreRuntime`
- replacing the current sidebar UX
- forcing a migration to backend thread-based message generation
- removing local-first state ownership
- archive/search/grouping work

## Next Milestone

Proposed next milestone for joint review:

### Milestone 3: Hybrid Backend-Backed Conversation Source of Truth

**Milestone 3 status: complete on both sides.**

- Backend contract work landed: normalized `/threads/{id}/state`, aligned `/threads/{id}/runs/stream` event shapes, `error` SSE event, append-semantics documentation, 5 contract-pinning tests, finalized `docs/api_reference.md`.
- Frontend integration landed: linked-thread history loads via `GET /threads/{id}/state`, generation runs through `POST /threads/{id}/runs/stream`, replace-each-tick handling of `messages/partial`, pre-send titles persisted on first linkage, backend reconciliation gated on Zustand hydration. Playwright E2E: 2 passed.

No open backend work for this milestone.

Current constraints for next-stage planning:

- keep auth out of scope until explicitly prioritized
- preserve the current `ExternalStoreRuntime` + Zustand architecture
- preserve `/v1/chat/completions` with `stream: true` unless both sides agree to move message history to backend threads
- treat backend-linked metadata as durable, while frontend message history remains frontend-owned for now

### Summary

Make backend thread APIs the durable source of truth for conversation history, while preserving the current frontend architecture and local-first UX.

This milestone keeps:

- `assistant-ui`
- `ExternalStoreRuntime`
- Zustand as the app-owned state layer
- current sidebar UX
- local persistence for responsiveness and cached continuity

This milestone changes:

- linked threads load message history from `GET /threads/{id}/state`
- linked threads generate through `POST /threads/{id}/runs/stream`
- `/v1/chat/completions` is used only for local-only or unlinked threads; once a thread is linked, all generation goes through `POST /threads/{id}/runs/stream` with no dual-path fallback on transient stream errors (see backend feedback A3)
- backend becomes the source of truth for messages on linked threads, not just metadata

### Proposed frontend changes

Extend `ChatThread` with backend history state:

- `historySource: "local" | "backend"`
- `historyLoaded: boolean`
- `historyLoadStatus: "idle" | "loading" | "loaded" | "error"`

Store/runtime behavior:

- local-only threads remain fully local
- linked threads keep locally cached messages for immediate rendering
- when switching to a linked thread, frontend loads backend state once if history is not yet loaded
- backend-loaded messages replace cached local messages for that linked thread
- local persistence remains via `zustand/persist`, but persisted linked-thread messages are treated as cache rather than authority

### Proposed backend API usage

Keep using:

- `POST /threads`
- `GET /threads`
- `PATCH /threads/{id}`
- `DELETE /threads/{id}`

Newly adopt:

- `GET /threads/{id}/state`
- `POST /threads/{id}/runs/stream`

Migration rule:

- if `backendThreadId` exists, use backend thread APIs for load and generation
- if `backendThreadId` is null, keep the current local-first flow up to first send
- on first send, create the backend thread and then immediately use `POST /threads/{id}/runs/stream` for that same send

### Source-of-truth policy

For linked threads, backend becomes the source of truth for:

- message history
- message ordering
- assistant outputs

Frontend remains the source of truth for:

- active thread selection
- thread order in the sidebar
- local-only threads
- transient UI state such as loading, cancel, and error indicators

Defaults:

- on thread switch, backend-loaded history replaces cached local history for that linked thread
- if backend history load fails, cached local messages remain visible and thread history state becomes `error`
- if backend run fails, preserve the user message locally and surface error state without clearing cached history

### UI behavior

Keep the current UI structure and visuals.

Add only minimal UX signals:

- per-thread history loading state when switching to a linked thread
- inline thread error state when backend history load or backend run fails

Explicit non-goals:

- redesigning `Thread`
- redesigning the sidebar
- archive/search/grouping work
- auth work in this milestone

### Proposed tests

Manual scenarios:

1. Create a new local thread and do not send a message.
   - It remains local-only.
   - No backend history endpoint is called.
2. Send the first message in a new thread.
   - Frontend calls `POST /threads`.
   - Frontend then streams through `POST /threads/{id}/runs/stream`.
   - Thread becomes linked and backend-backed for future history.
3. Reload and reopen a linked thread.
   - Frontend calls `GET /threads` for metadata.
   - On selecting the linked thread, frontend loads `GET /threads/{id}/state`.
   - Conversation history matches backend state.
4. Switch between one linked thread and one local-only thread.
   - linked thread rehydrates from backend
   - local-only thread remains local
   - no duplication occurs
5. Backend load failure for a linked thread.
   - cached local messages remain visible
   - thread shows error state
   - app remains usable
6. Cancel a linked-thread run mid-stream.
   - browser request aborts cleanly
   - partial assistant content remains
   - follow-up send still works

Automated checks to add:

- linked thread first-send path uses backend run flow
- linked thread reload + reopen restores backend message history
- local-only thread remains local after reload
- mixed linked/local switching does not clobber local-only state
- backend load failure preserves cached local messages and shows error state

### Assumptions and defaults

- This is Milestone 3, following:
  - Milestone 1: stable local frontend thread + sidebar baseline
  - Milestone 2: backend-linked thread metadata and hydration
- Auth remains out of scope.
- On future logout, local persisted threads will be cleared.
- On future login, anonymous local threads will be discarded rather than imported.
- Frontend will preserve the current `ExternalStoreRuntime` + Zustand architecture and adapt backend history/runs behind that layer rather than switching runtime families.
- No new backend endpoints are proposed; if `/state` or `/runs/stream` need frontend-facing shape normalization, that should be handled as contract clarification rather than endpoint expansion.

### Original questions to backend (now answered below)

Points the frontend raised before implementation:

1. Is the current `GET /threads/{id}/state` message shape stable enough for direct frontend conversion into `ThreadMessageLike[]`?
2. Is the current `POST /threads/{id}/runs/stream` SSE event shape stable enough for direct frontend consumption?
3. Should first-send generation move fully to `/threads/{id}/runs/stream` in this milestone, or is a temporary fallback to `/v1/chat/completions` still preferred if thread-run streaming fails?

### Backend feedback on Milestone 3

Lead backend position:

**A1: `GET /threads/{id}/state` shape is not yet frontend-friendly — backend will normalize.**

The current response uses LangChain's `messages_to_dict` serialization:

```json
{
  "values": {
    "messages": [
      {"type": "human", "data": {"content": "hi", "additional_kwargs": {...}, "id": null, ...}},
      {"type": "ai",    "data": {"content": "hello", "tool_calls": [], "usage_metadata": null, ...}}
    ]
  },
  "tasks": []
}
```

This is awkward to convert to `ThreadMessageLike[]` on the frontend (nested `data`, role name mismatch `human`/`ai` vs `user`/`assistant`, many unused LangChain-internal fields). Backend will add a flat, stable shape before frontend consumes this endpoint:

```json
{
  "thread_id": "...",
  "messages": [
    {"id": "...", "role": "user",      "content": "hi"},
    {"id": "...", "role": "assistant", "content": "hello"}
  ]
}
```

The existing LangChain-format response will remain available (non-breaking) but the new shape is what we recommend the frontend consume. Exact contract will land in `docs/api_reference.md`.

**A2: `POST /threads/{id}/runs/stream` SSE shape needs one fix + documentation.**

Current event shapes:

- `messages/partial` / `messages/complete`: `[{"type": "ai", "id": "...", "content": "<accumulated text>"}]`
- `values`: full state object in LangChain `messages_to_dict` format (same awkward shape as `/state`)
- `end`: `null`

Issues:
- `messages/partial` emits the **accumulated** content each tick, not a delta. Frontend either accumulates (wasteful) or replaces each tick (works, but renames the primitive). The current name implies delta semantics. Backend will clarify: the payload is the running accumulation, and frontend should replace-on-each-chunk, not append. Name stays `messages/partial` for now — renaming would break the current non-streamed `messages/complete` symmetry.
- `values` payload needs to match the normalized shape from A1.
- `error` event is not currently emitted. If the LLM call fails mid-stream, the connection simply closes. Backend will add an `error` event with `{"message": "..."}` and emit it before closing on exceptions.

**Backend will also document the critical input-semantics rule:**

> `input.messages` on `POST /threads/{id}/runs/stream` is **appended** to checkpointer state via the `add_messages` reducer. The frontend must send **only the new user message**, not the full history. Sending the full history will duplicate messages.

This is currently undocumented and is a significant foot-gun.

**A3: Move fully to `/threads/{id}/runs/stream` for linked threads. No dual-path fallback.**

Recommendation: once a thread has a `backendThreadId`, all generation goes through `/threads/{id}/runs/stream`. Do not fall back to `/v1/chat/completions` on transient stream errors — that would desync the backend state (backend would have the user message in state, but the assistant reply would come from a stateless endpoint and never be persisted).

The correct failure handling for a linked-thread run is:
1. Show an error state on the thread
2. Keep the user message visible locally
3. Let the user retry — retry should hit `/threads/{id}/runs/stream` again

`/v1/chat/completions` remains only for: local-only threads (no `backendThreadId`), Open WebUI, and the first send (where the sequence is `POST /threads` → `POST /threads/{id}/runs/stream`; if `POST /threads` itself fails, frontend may fall back to `/v1/chat/completions` and keep the thread local).

### Backend deliverables for Milestone 3 — status

All 7 items complete:

1. ✓ Normalized `GET /threads/{id}/state` — response is now `{thread_id, messages: [{id, role, content: [{type:"text",text}]}]}`. See `app/api/normalize.py` and `app/api/threads.py`.
2. ✓ `values` SSE event now emits the same normalized shape (`{thread_id, messages}`).
3. ✓ `error` SSE event emitted on `astream_events` exceptions, followed by `end`. Stream closes cleanly.
4. ✓ `input.messages` append semantics documented in `docs/api_reference.md` with correct/incorrect examples.
5. ✓ SSE-shape stability tests pin event names, ordering, and payload keys (`test_sse_event_sequence_and_shape`, `test_state_response_shape`, `test_run_input_messages_are_appended_not_replaced`, `test_run_emits_error_event_on_failure`).
6. ✓ Integration test covering create → run → state → run → state with normalized-shape validation at each step (`test_integration_full_conversation_cycle`).
7. ✓ `docs/api_reference.md` updated with final request/response examples, event sequence, error flow, and ExternalStoreRuntime integration guidance.

Test count: 29 passing (17 pre-existing + 12 added or updated). No new endpoints were needed.

**Message role mapping** (LangChain → normalized): `human` → `user`, `ai` → `assistant`, `system` → `system`, `tool` → `tool`.

### What the frontend can rely on

- `GET /threads/{id}/state` returns `{thread_id, messages}` with messages already in `ThreadMessageLike`-compatible shape for text-only content
- `POST /threads/{id}/runs/stream` emits `messages/partial` (accumulated, replace-each-tick) → `messages/complete` → `values` → `end`, or `error` → `end` on failure
- `input.messages` is **append-only** — send only the new user message, never full history
- Both endpoints return 404 for unknown thread ids (thread metadata is the source of truth for existence)

### Resolved: message content shape

**Decision:** `content: Array<{ type: "text"; text: string } | ...>` — matches `ThreadMessageLike` exactly.

For Milestone 3, backend emits **text parts only**. Additional part types (tool calls, images, attachments) are deferred to the future tool-ui work and will be added to the same array without a breaking migration.

Example normalized message:

```json
{
  "id": "msg-...",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello" }]
}
```

## Contract Follow-Up

API contract updates should happen after both sides agree on:

1. what thread identity fields the frontend will persist locally
2. when a local thread becomes a backend-linked thread
3. which backend thread endpoints are required for metadata synchronization first
4. whether message generation stays on `/v1/chat/completions` during this milestone

### Backend Comments (for frontend to review)

**Q1: Thread identity fields**

The backend `POST /threads` currently returns a `thread_id` (UUID string). For the frontend `ChatThread` type, we suggest adding:

```ts
backendThreadId: string | null;
```

Nullable so that local-only threads (not yet synced) remain valid. Are there other backend-originated fields the frontend wants to persist? Candidates: `created_at` (server timestamp), `metadata` (arbitrary key-value). Or is `backendThreadId` alone enough for this milestone?

**Q2: When does a local thread become backend-linked?**

Our suggestion: **on first message send**. The flow would be:

1. User creates a thread → stays local-only (`backendThreadId: null`)
2. User sends the first message → frontend calls `POST /threads` to create the backend thread, stores the returned `thread_id` as `backendThreadId`
3. Subsequent metadata operations (rename, delete) use `backendThreadId` to call backend endpoints

This avoids creating backend threads for empty/abandoned conversations. Alternative: create the backend thread immediately on "New Thread" click. Which does the frontend prefer?

**Q3: Which backend thread endpoints are needed first?**

The backend already exposes these thread endpoints:

| Method | Path | What it does |
|--------|------|-------------|
| `POST` | `/threads` | Create a thread (returns `thread_id`) |
| `GET` | `/threads` | List threads (returns array of thread metadata) |
| `GET` | `/threads/{id}/state` | Get thread messages |
| `PATCH` | `/threads/{id}` | Update title, metadata, is_archived |
| `DELETE` | `/threads/{id}` | Delete a thread |
| `POST` | `/threads/{id}/generate-title` | LLM-generated title from messages |

For this milestone, the minimum set is probably: **create, list, patch (rename), delete**.

One caveat: thread metadata (title, created_at, is_archived) is currently stored **in-memory** on the backend — it does not survive a server restart. Before the frontend relies on it as a sync target, the backend needs to persist this to Postgres. This is backend work we can do before or in parallel with frontend integration. Does the frontend need `GET /threads` (list) for this milestone, or is local-first thread list sufficient with only individual CRUD calls?

**Q4: Message generation path**

Confirmed: `/v1/chat/completions` with `stream: true` stays as the generation path for this milestone. No change needed on either side.

One forward-looking note: the current `/v1/chat/completions` path creates an ephemeral backend thread per request (messages are not persisted across calls). This is fine because the frontend owns message history. When we eventually move to backend-persisted messages (future milestone), we would switch to `POST /threads/{id}/runs/stream`. No action needed now — just flagging for awareness.

### Frontend Position

**A1: Thread identity fields**

For this milestone, frontend only needs:

```ts
backendThreadId: string | null;
```

That is enough for initial linkage.

Frontend does **not** need server `created_at` or backend `metadata` yet for this milestone.

Reasoning:

- current thread list remains local-first
- local store already owns `createdAt`, `updatedAt`, `title`, and message history
- adding more backend-owned fields now would increase sync complexity without changing current UX

So the frontend position is: **`backendThreadId` alone is enough for the milestone start**.

**A2: When a thread becomes backend-linked**

Frontend prefers: **link on first message send**.

Agreed flow:

1. User creates a thread locally
2. Thread remains local-only while empty
3. On first message send, frontend creates the backend thread with `POST /threads`
4. Returned `thread_id` is stored as `backendThreadId`
5. Later metadata operations use `backendThreadId` if present

Reasoning:

- avoids creating backend records for abandoned empty threads
- preserves current local-first UX
- matches current frontend thread lifecycle more naturally

So the frontend position is: **create backend thread on first send, not on New Thread click**.

**A3: Required backend thread endpoints for this milestone**

Frontend only needs this first set:

- `POST /threads`
- `PATCH /threads/{id}`
- `DELETE /threads/{id}`

Frontend does **not** need `GET /threads` for the initial backend-linking milestone, because the current source of truth for the sidebar remains the local persisted store.

Frontend also does **not** need `GET /threads/{id}/state` yet, because message history remains frontend-owned for this milestone.

Implication:

- backend list/state endpoints are not blockers for the next step
- frontend can begin backend linkage with create/rename/delete only

One important note:

- if frontend starts syncing rename/delete to backend, backend metadata persistence should become durable before frontend depends on it as a reliable sync target

So the frontend position is: **local-first thread list remains authoritative for this milestone; backend CRUD is additive linkage, not the source of truth yet**.

**A4: Message generation path**

Confirmed from frontend side:

- `/v1/chat/completions`
- `stream: true`
- frontend-owned message history

No change requested for this milestone.

## Working Agreement

Frontend and backend are currently aligned on this sequence:

1. stabilize local frontend architecture first ✓ complete
2. add backend-linked thread identity next ← current milestone
3. update API contract after milestone agreement

## Backend Deliverable Status

### Completed: Persistent thread metadata store

The backend has replaced the in-memory `_thread_metadata` dict with a Postgres-backed store. Thread metadata now survives server restarts.

**What was done:**

- New module: `app/core/thread_store.py`
  - Creates a `thread_metadata` table in Postgres (same database as the LangGraph checkpointer)
  - Columns: `thread_id` (PK), `title`, `created_at`, `is_archived`, `metadata` (JSONB)
  - Full CRUD: `create_thread`, `get_thread`, `list_threads`, `update_thread`, `delete_thread`
  - Dual-mode: Postgres for production, in-memory dict for tests (no external deps needed to run tests)
- `app/api/threads.py` — all endpoint handlers now call `thread_store.*` instead of reading/writing the old in-memory dict
- `app/main.py` — lifespan opens a dedicated `psycopg.AsyncConnection` and calls `init_store(conn)` alongside the checkpointer setup
- `tests/conftest.py` — calls `init_store()` (no-arg) to use in-memory backend for tests
- All 17 existing tests pass, no regressions

**What this means for frontend:**

- `POST /threads`, `PATCH /threads/{id}`, and `DELETE /threads/{id}` are now durable
- Thread titles, archive state, and custom metadata persist across server restarts
- Frontend can begin wiring backend linkage whenever ready
- No endpoint signatures or response shapes changed — the API contract is identical

### What's next (waiting on frontend)

Backend is ready. Frontend can now:

1. Add `backendThreadId: string | null` to `ChatThread`
2. Call `POST /threads` on first message send to create the backend thread
3. Wire rename/delete to `PATCH`/`DELETE` when `backendThreadId` is present

### Follow-ups from frontend review (resolved)

Frontend review flagged three issues; all are now fixed:

1. **DELETE was a soft-delete** — it only removed metadata, not checkpointer state, so the thread could still be resumed via `POST /threads/{id}/runs/stream`. Fixed: `DELETE /threads/{id}` now also calls `checkpointer.adelete_thread(thread_id)`, and both `GET /threads/{id}/state` and `POST /threads/{id}/runs/stream` now return 404 for threads that are not in the metadata store. Metadata is the single source of truth for thread existence.
2. **GET /threads dropped the title fallback** — the first-user-message preview title was missing after the metadata refactor. Fixed: the fallback is restored, matching the documented behavior in `docs/api_reference.md`.
3. **PATCH/DELETE paths were untested** — added 7 new tests covering rename, archive, 404 on unknown thread, 404 on state/runs for deleted thread, and title fallback. Full test count is now 24, all passing.

All changes exercise the same CRUD API the frontend will consume, so the fixes are verified end-to-end through the FastAPI app.

## Frontend Milestone Progress

Frontend implementation of the backend-linking milestone is complete.

Current behavior:

- local thread records include `backendThreadId: string | null`
- local thread records include `syncStatus` and `lastSyncedAt`
- backend thread is created on first message send
- backend thread metadata is hydrated from `GET /threads` on app startup
- thread rename syncs to backend when `backendThreadId` exists
- thread delete syncs to backend when `backendThreadId` exists
- message generation remains on `/v1/chat/completions` with `stream: true`
- local-first UX and local persistence remain unchanged
- backend-linked metadata reconciliation does not overwrite frontend-owned message history

Verification status:

- Playwright E2E coverage for reload hydration and mixed local/backend thread persistence is now passing
- current E2E result: 2 passed

---

## Milestone 4 (Proposed): Auth + Thread Ownership + Protected Area

**Status:** draft for joint review. Backend-led. Awaiting frontend input on session model and login UX.

### Goal

Introduce user identity, enforce per-user thread ownership, and gate a new "Assisted Learning" product area behind sign-in. Use this as the testbed for the minimal auth surface.

### Chosen approach: OIDC (social login, hosted provider)

The user's stated preference is "least complex route." Social-login OIDC beats self-hosted IdP (Authentik/Keycloak) for this reason — no IdP to run, no user/password storage, shortest code path on both sides.

**Confirmed: Google OIDC only for M4.** Open to any Google account (no domain allowlist). GitHub is deferred to a follow-up because GitHub's browser OAuth flow returns an opaque access token rather than a JWKS-verifiable ID token, which would force backend to call `GET /user` server-side and mint its own session — that breaks the "pure OIDC, bearer-only" shape we want for M4. Allowlist and additional providers can be added later as config.

Trust boundary:

- Frontend performs the OIDC dance (Authorization Code + PKCE) directly against the chosen provider
- Frontend receives an ID token (JWT) from the provider
- Frontend sends ID token as `Authorization: Bearer <id_token>` on thread endpoints
- Backend verifies the JWT by looking up the provider's JWKS via the token's `iss` claim, checks `aud`/`exp`/signature, and rejects invalid/expired tokens with `401`
- `user_id` is namespaced as `{provider}:{sub}` (e.g. `google:1234567890`, `github:42`) to prevent collisions across the two `sub` spaces

Backend does not hold an OAuth client secret, does not issue its own session cookies, does not run an IdP. This is the thinnest viable auth shim.

Backend config is list-shaped for forward-compat (one entry in M4):

```
OIDC_PROVIDERS = [
  {name: "google", issuer: "https://accounts.google.com", aud: "<google-client-id>"},
]
```

JWKS URLs are discovered from each issuer's `/.well-known/openid-configuration` and cached. Adding a second provider later is a config-only change.

### Scope (option B — full vertical slice)

In scope:

- backend JWT verification middleware for `/threads*` endpoints
- `user_id` column added to `thread_metadata` (TEXT, NOT NULL after migration)
- all thread CRUD + state + runs filtered by `user_id`; cross-user access returns `403`
- anonymous threads (pre-auth) deleted on the first authenticated request per the migration plan below
- `/v1/chat/completions` and `/v1/models` remain **bearer-less** (OpenAI-compat clients like Open WebUI do not carry our JWTs)
- `/api/chat*` and `/health` remain bearer-less
- new feature flag / route: **Assisted Learning** protected area — backend gates via the same JWT; frontend hides the nav entry when unauthenticated

Not in scope:

- password-based auth
- self-hosted IdP
- refresh-token rotation logic on backend (frontend handles refresh with Google directly)
- per-user quotas or rate limiting
- sharing / multi-user threads
- auth on `/v1/*` (remains bearer-less for Open WebUI compatibility)
- admin roles / RBAC

### Multi-tenancy semantics

- every thread is owned by exactly one `user_id`
- `GET /threads` returns only the caller's threads
- `GET/PATCH/DELETE /threads/{id}` and `/threads/{id}/state|runs/stream` return `403` if the thread exists but belongs to another user, `404` if it doesn't exist
- `POST /threads` records `user_id` from the verified JWT
- anonymous (pre-auth) local threads that hit backend after login are **not** imported — frontend discards them (matches the assumption already stated in M3)

### Migration of existing anonymous threads

Currently `thread_metadata` rows have no `user_id`. Options considered:

1. **Backfill to a sentinel user and leave them addressable** — leaks state across future users
2. **Delete on migration** — clean, matches the "discarded rather than imported" stance already agreed in M3
3. **Keep addressable only by direct ID until TTL** — adds complexity

Recommendation: **option 2**. On M4 deploy:

- `ALTER TABLE thread_metadata ADD COLUMN user_id TEXT;`
- `DELETE FROM thread_metadata WHERE user_id IS NULL;`
- also delete orphaned checkpointer state for those thread_ids
- `ALTER TABLE thread_metadata ALTER COLUMN user_id SET NOT NULL;`
- `CREATE INDEX ON thread_metadata (user_id, created_at DESC);`

Single-shot migration. No compatibility window needed since this is pre-production.

### Assisted Learning (product testbed)

Purpose in M4: a minimal, concrete feature that is visible only when signed in, used to exercise the end-to-end auth contract from nav gating to backend route protection.

Backend exposes (stubbed for M4):

- `GET /assisted-learning/modules` → returns a static list for now; requires valid bearer
- (content itself is out of scope; this is the auth vehicle)

Frontend renders:

- sidebar / nav entry for "Assisted Learning" hidden when unauthenticated
- page that calls `GET /assisted-learning/modules` and renders the list
- signed-out state on the page redirects to login

This gives us one protected route that isn't the chat surface, so we can verify the auth enforcement is actually doing work and not just passing through.

### Session model — deferred to frontend

Per user direction, the backend will not prescribe the session model. Frontend chooses:

- where Google ID token lives (memory, sessionStorage, localStorage, or httpOnly proxy cookie)
- refresh cadence
- logout flow

Backend only consumes `Authorization: Bearer <jwt>`. The only backend constraints that leak into session design:

- JWT `aud` must be the frontend's Google OAuth client ID (backend will be configured with the expected `aud`)
- backend accepts Google-issued ID tokens only (no custom BE-issued tokens in M4)

### Proposed backend changes

- new module: `app/core/auth.py` — multi-provider JWKS fetch + cache (keyed by `iss`), JWT verify (iss, aud, exp, sig), FastAPI dependency `get_current_user() -> UserClaims` where `user_id = "{provider}:{sub}"`
- `app/api/threads.py` — all handlers take `user = Depends(get_current_user)` and scope queries by `user.user_id`
- `app/core/thread_store.py` — add `user_id` to schema, all queries filtered by `user_id`, `list_threads` signature becomes `list_threads(user_id, include_archived=False)`
- `app/api/assisted_learning.py` — new router, single `GET /assisted-learning/modules` stub returning `[{id, title, description, href}]`
- config: `GOOGLE_OIDC_CLIENT_ID` (issuer + JWKS URL discovered from Google's OIDC metadata endpoint)
- tests: add fake JWT signer fixture (no live Google calls); cover 401 (no token / bad sig / expired), 403 (cross-user), 404 (unknown thread), success paths for all thread endpoints, and the new assisted-learning endpoint

### Open questions for frontend

1. **Session model** — where does the Google ID token live, and how is it refreshed before expiry (Google ID tokens are 1h)?
2. **Login UX** — dedicated `/login` route, modal, or hosted Google flow with redirect back to the SPA?
3. **Logout** — on logout, frontend clears local persisted threads per M3 assumption. Confirm backend doesn't need to do anything (we don't hold sessions).
4. **Open WebUI path** — Open WebUI is anonymous on `/v1/*`. Is that acceptable, or do we want to eventually put `/v1/*` behind a separate static API key? (Proposal: defer to post-M4.)
5. **Assisted Learning surface** — what functional content should the M4 stub contain? Enough to verify the gate works is fine; anything beyond that needs a separate scoping pass.
6. **Unauthenticated baseline** — when the user has never signed in, do we still allow the current local-only chat to work (unlinked threads via `/v1/chat/completions`), or do we gate the whole app behind login? (Backend recommendation: keep local-only chat usable when signed out; only linked threads and Assisted Learning require auth.)

### Frontend review and answers

**F1: Session model**

Frontend prefers `sessionStorage` for the Google ID token in M4.

Reasoning:

- lower leakage risk than `localStorage`
- survives reloads in the current browser tab/session
- simple to implement with no backend session state
- matches the "backend only consumes bearer token" direction

Refresh policy for M4:

- no silent refresh in this milestone
- on token expiry, treat the user as signed out and require re-login

**F2: Login UX**

Frontend prefers a dedicated `/login` route with redirect back to the app after the Google OIDC flow.

Reasoning:

- simpler than modal-based OAuth handling
- easier to debug and test
- cleaner path for future protected routes like Assisted Learning

**F3: Logout**

Confirmed: backend does not need to do anything on logout for M4.

Frontend logout behavior should be:

- remove the token from `sessionStorage`
- clear persisted Zustand thread state
- redirect to the signed-out baseline

**F4: Open WebUI path**

Frontend agrees that `/v1/*` can remain bearer-less for M4.

Any API-key protection for Open WebUI compatibility should be deferred to a later milestone.

**F5: Assisted Learning surface**

For M4, the protected stub should stay minimal.

Recommended module shape:

- `id`
- `title`
- `description`
- `href` or `slug`

That is enough to verify:

- nav gating
- route protection
- authenticated fetch
- signed-out redirect behavior

**F6: Unauthenticated baseline**

Frontend prefers to keep the current local-only chat usable when signed out.

Auth should be required only for:

- backend-linked threads
- Assisted Learning

This avoids making auth a blocker for the baseline chat experience.

### Frontend comments on product questions

- **Provider choice:** frontend recommends Google only for M4; add GitHub later if needed
- **Assisted Learning content:** minimal module list is enough for M4 (`id`, `title`, `description`, `href|slug`)
- **Allowed-email policy:** frontend is fine with open access for M4; allowlist can be added later as config

### Open questions for user (product)

1. **Provider choice** — Google only for M4, or Google + GitHub? (Recommendation: Google only; add GitHub in a follow-up.)
2. **Assisted Learning content** — what does a "module" look like? (Title + description + link is enough for the M4 gate-verification stub.)
3. **Allowed-email policy** — is this open to any Google account, or restricted to a specific domain / allowlist? (Recommendation: open for M4; allowlist can be a config flag added later.)

### Success criteria

- sending any `/threads*` request without a valid Google ID token returns `401`
- user A cannot read, run, rename, or delete user B's threads (`403`)
- `GET /threads` returns only the caller's threads
- anonymous threads present at migration time are removed cleanly
- `GET /assisted-learning/modules` returns `200` with a valid token, `401` without
- `/v1/chat/completions`, `/health`, `/api/chat*` continue to work with no auth
- all existing M3 contract tests still pass; new auth tests cover the 401/403/404 matrix

### Milestone 4 / Phase 5 Status Update

The auth milestone is now complete for the currently agreed scope.

Delivered:

- backend bearer-token verification for protected routes
- per-user thread ownership enforcement
- protected Assisted Learning backend route
- frontend signed-out baseline plus protected signed-in UX
- dev-token auth path retained as test infrastructure for Playwright and local integration testing
- Clerk-based register / login / logout flow
- Clerk-backed protected thread flow
- Clerk-backed Assisted Learning access
- legacy direct Google frontend auth path removed; Clerk is now the only end-user auth UX

Verification completed:

- backend auth tests pass
- frontend typecheck passes
- Playwright E2E passes with backend `AUTH_DEV_MODE=True`
- current Playwright coverage count: 12 tests across auth flow, thread hydration, and thread edge cases
- manual end-to-end validation passed for:
  - register
  - login
  - logout
  - protected thread flow
  - Assisted Learning
  - linked-thread reload/history hydration
  - signed-out fallback chat

Additional regression coverage added after implementation:

- reopen linked thread after logout/login without sending a new message
- logout clears linked-thread shells and returns to the signed-out baseline
- deleted linked thread stays deleted after reload and re-login
- invalid persisted token forces sign-out on the next protected fetch
- long linked-thread title persists across reload
- higher-count local-only thread list persists across reload

Known accepted behavior:

- backend-linked thread rows may briefly show `0 messages Linked` after login or reload until the user opens the thread
- this is due to metadata-only sidebar hydration plus lazy `/threads/{id}/state` loading
- acceptable for the current dev/test UI because the production UI is expected to hide that status line

Deferred follow-up only:

- move Clerk from development mode to a production instance/domain
- keep `AUTH_DEV_MODE` and `/auth/dev-token` unless replaced by another stable E2E auth mechanism

---

## Milestone 5 (Proposed): Mobile Demo With `assistant-ui/native`

**Status:** Phase 1 complete. Frontend-led, with minimal backend change required.

### Phase 1 outcome

Phase 1 focused on mobile bring-up and viability proof, not full product parity polish.

Implemented and manually validated:

- Expo-based mobile app shell in `mobile-v1`
- Clerk mobile sign-in entry flow
- signed-in mobile shell booting against the existing backend
- backend-linked thread list loading on mobile
- protected Assisted Learning screen loading on mobile
- main mobile controls reachable after safe-area fixes
- `@assistant-ui/react-native` prototype route mounting successfully
- native prototype sending a prompt and receiving a visible assistant response against the existing backend

Phase 1 caveats / accepted limits:

- the main mobile shell is functional but still layout-first rather than product-polished
- the `Native prototype` route is validated only as a local runtime / backend-response proof, not as the final mobile chat architecture
- native prototype currently uses a non-streaming fallback on native platforms because Expo/Hermes streaming via `fetch(...).body.getReader()` was not reliable enough for the first pass
- Expo / `react-native-screens` compatibility warnings remain known technical debt for later cleanup, but they do not block the current Phase 1 demo

What Phase 1 does **not** claim complete yet:

- final mobile thread UX
- deep `assistant-ui/native` parity with the backend-owned thread runtime
- mobile rename/delete polish
- broad device matrix validation
- mobile automated test coverage

### Phase 2 outcome

Phase 2 focused on turning the working mobile demo into a cleaner product-shaped mobile flow.

Primary objectives:

- replace the current top-of-screen thread list with a more mobile-native thread navigation pattern
- improve chat-screen layout, spacing, and composer behavior for phone-sized screens
- reduce the gap between the validated `Native prototype` and the main signed-in chat flow
- move more of the main thread experience toward `@assistant-ui/react-native` primitives where that improves long-term parity
- keep the same backend contract and avoid reopening backend scope unless a concrete blocker appears

Implemented and validated:

- main signed-in mobile experience should keep chat as the primary screen
- the mobile screen should be organized into three vertical zones:
  1. top navigation bar
  2. main content area
  3. bottom composer area
- top navigation bar should be:
  - left: `Threads` trigger that opens the thread/history sheet
  - center: tab switcher for `Chat`, `Native`, and `Learn`
  - right: `User` control
    - signed in: user/account button with sign-out
    - anonymous: sign-in / register entry
- thread history should live behind the left-side trigger as a scrollable sheet/overlay, not dominate the default screen
- auth entry remains auth-first for now

What landed in Phase 2:

- mobile-native thread navigation pattern
  - thread/history behind a left-side trigger using a modal sheet or drawer-like pattern
- top navigation bar with:
  - `Threads`
  - tab switcher
  - `User`
- improved chat screen structure
  - better message area sizing
  - better composer placement
  - safer action-button placement
- mobile thread create/switch/reload flow polish
- `Native prototype` remains available as a validated sidecar tab/route rather than being forced prematurely into the main chat path
- thread history sheet now behaves as the primary thread-management surface for mobile
- thread cards now use a preview-card style with per-row contextual delete action
- user/account control is personalized as an avatar-style affordance
- thread sheet has a clearer dismiss hint via drag handle

Still deferred after Phase 2:

- backend API changes
- push notifications
- offline sync
- attachments
- full mobile automated E2E
- final design-system polish across all devices
- archive UX
- grouped-thread UX
- real-time metadata updates for future grouping features

Phase 2 result:

- thread navigation feels mobile-native rather than web-layout-transplanted
- primary chat experience is comfortable on a phone-sized screen
- main signed-in mobile flow is clearer than the current bring-up shell
- no regression observed in:
  - login
  - thread list loading
  - thread open / send
  - Assisted Learning access
- the next step toward full `assistant-ui/native` alignment remains explicit without forcing premature architecture changes

### Phase 3 complete

Phase 3 focused on the mobile composer and on-device voice affordances.

What shipped:

- composer sizing and layout were improved for phone screens
- the chat composer now includes a microphone button
- on-device speech-to-text is wired through `expo-speech-recognition`
- dictated text can populate the composer and still be edited before send
- assistant replies now expose an on-device read-aloud button via `expo-speech`

Dependency direction used:

- on-device speech recognition and text-to-speech, not cloud services
- `expo-speech-recognition` for speech-to-text
- `expo-speech` for read-aloud
- Expo development build / native run workflow rather than Expo Go
- backend remained unchanged

Validation outcome:

- voice input reaches native listening state successfully
- on-device TTS execution path is wired successfully
- emulator audio quality/input routing was the main weak point during validation, not the integration path itself
- typed send flow remained stable

Cost result:

- no recurring speech API cost
- no backend audio upload or provider integration

Still out of scope after Phase 3:

- full duplex voice conversation
- spoken assistant playback controls beyond the basic per-message read-aloud button
- background audio session work
- advanced interruption / routing handling
- backend voice APIs

### Future capability note: thread grouping / clustering

Not for current implementation, but the current framework should preserve room for this direction:

1. backend can already enumerate all threads for an authenticated user via `/threads`
2. backend can later add automatic clustering/grouping based on thread subject matter
3. backend can persist grouping metadata on thread records, for example:
   - `group_id`
   - `group_label`
   - `group_status`
4. frontend can later consume grouping labels from normal thread hydration without changing the core mobile/web thread model
5. a future thread-row action can include:
   - `Delete`
   - `Go to group`
   - eventually `Archive` once archive UX is fully defined

Important constraint:

- the current framework does **not** yet include real-time backend-to-frontend push for metadata updates
- so when grouping labels become available asynchronously, the initial delivery model should likely be:
  - refresh on thread list load
  - periodic polling
  - or explicit refresh
- real-time push can be deferred unless grouping freshness becomes important enough to justify subscriptions/websockets

Design implication for current work:

- avoid painting the thread metadata model into a corner
- keep room for future grouped-thread labels and navigation
- do not implement archive/group UX prematurely without defining where grouped/archived threads live in the product

### Goal

Bring the current demo to mobile using `assistant-ui`'s React Native stack as the primary integration path, not a custom mobile chat architecture.

The milestone goal is not to invent a separate mobile product. The goal is to prove that the same demo can run on mobile with:

- the same backend
- the same thread model
- the same auth model
- the same core assistant behavior

while using React Native-native UI primitives and navigation patterns.

Platform target for this milestone:

- one shared mobile app codebase
- intended to run on both iOS and Android
- milestone validation focuses on cross-platform viability, not equal platform-specific polish

### Guiding principle

Use `assistant-ui/native` (`@assistant-ui/react-native`) as the foundation.

Per the official assistant-ui React Native docs:

- React Native primitives are available via `@assistant-ui/react-native`
- the runtime core is shared with web through `@assistant-ui/core`
- backend APIs and runtime concepts can transfer directly from web
- for custom backends, mobile can use either:
  - local thread/message storage with a `ChatModelAdapter`
  - or remote thread management with a `RemoteThreadListAdapter`

This milestone should follow that intended architecture rather than building an ad hoc mobile-only state layer.

### What carries over from the current web implementation

Based on the assistant-ui React Native migration docs, the following should transfer directly or near-directly:

- backend APIs
  - `/threads`
  - `/threads/{id}/state`
  - `/threads/{id}/runs/stream`
  - `/assisted-learning/modules`
  - `/v1/chat/completions` for signed-out baseline if we keep it
- runtime concepts
  - streaming message updates
  - thread create/switch/delete
  - cancel behavior
  - tool registration shape (if/when used)
- auth model
  - bearer token sent to protected backend endpoints
  - same user/thread ownership semantics
- normalization contract
  - backend `{ thread_id, messages }`
  - normalized SSE event shapes

### What changes on mobile

The UI layer changes from web primitives to React Native primitives.

Instead of `@assistant-ui/react` web components, mobile should use React Native primitives such as:

- thread primitives
- composer primitives
- message primitives
- thread list primitives

Mobile-specific concerns:

- navigation and screen structure
- keyboard avoidance and safe areas
- scroll performance for long message lists
- attachment integration only if explicitly in scope
- auth handoff appropriate for React Native
- persistent local storage via mobile-native storage rather than browser storage

### Recommended architecture

#### Option A: fastest path for the demo

Use `@assistant-ui/react-native` with:

- `useLocalRuntime` for on-device thread/message state
- a `ChatModelAdapter` for inference calls
- local persistence via React Native storage

This is the fastest route to get a mobile demo working, but it would diverge from the current backend-owned thread model.

#### Option B: preferred path for parity with the web demo

Use `@assistant-ui/react-native` with:

- `useRemoteThreadListRuntime`
- a `RemoteThreadListAdapter` backed by the existing `/threads` CRUD endpoints
- a mobile chat adapter that streams through the existing backend endpoints
- local cache only as a mobile optimization, not as the source of truth for linked threads

Recommendation: **Option B**

Reason:

- preserves the current backend-backed thread model
- gives better parity with the web demo
- avoids inventing a second product architecture just for mobile
- aligns with assistant-ui's documented remote thread adapter path

### Mobile app scope

In scope for the first mobile milestone:

- a React Native app shell
  - likely Expo unless there is a strong reason not to
- one generic mobile app targeting both iOS and Android from the same codebase
- mobile chat screen using `@assistant-ui/react-native`
- mobile thread list / thread switcher
- signed-in protected thread flow against existing backend
- signed-out baseline behavior decision mirrored from web
- protected Assisted Learning list screen
- mobile auth flow compatible with the current Clerk-based model
- basic persistence of auth/session state and local mobile UI state

Not in scope:

- push notifications
- offline-first sync
- attachments unless required
- voice input/output
- tablet-specific layout polish
- platform-specific native UX polish beyond what is needed to prove parity
- deep multi-platform design-system work
- a separate mobile backend

### Auth on mobile

The mobile app should preserve the current auth direction:

- Clerk remains the end-user auth system
- backend still consumes bearer tokens
- backend ownership model does not change

Open implementation choice for the mobile client:

- use Clerk's React Native / Expo integration if compatible with the chosen app shell
- store session state using the recommended native storage path for that stack

The mobile milestone should not re-open backend auth architecture. It should consume the existing backend contract.

### Backend expectations

No major backend redesign is expected for this milestone.

Backend should be treated as already prepared for mobile if:

- bearer auth works from a non-browser client
- CORS / mobile networking setup is correct for simulator/device development
- the existing `/threads*` and `/assisted-learning/modules` endpoints remain stable

Potential backend follow-up only if needed:

- small auth/CORS adjustments for device testing
- documentation additions for mobile auth token usage

### UI structure recommendation

Recommended initial mobile screens:

1. Auth entry / session bootstrap
2. Thread list screen
3. Chat thread screen
4. Assisted Learning screen

Navigation should stay simple in Milestone 5:

- stack or tab + stack navigation
- no attempt to reproduce the web sidebar literally

The objective is product parity, not UI mimicry.

### Data and runtime plan

Recommended implementation split:

1. Build a mobile backend adapter layer that mirrors the current web API calls
2. Implement remote thread list runtime using `RemoteThreadListAdapter`
3. Implement streaming run adapter against `/threads/{id}/runs/stream`
4. Load thread state from `/threads/{id}/state`
5. Reuse normalized backend message/event contracts as-is

This should minimize backend-specific mobile logic and keep the mobile client close to the current web contract.

### Test plan

Manual mobile scenarios:

1. Sign in on mobile and load existing backend-linked threads
2. Open an existing linked thread and verify history loads
3. Send a new message and verify streaming works
4. Create a new thread and verify it appears on reload
5. Delete or rename a thread and verify persistence
6. Open Assisted Learning while signed in
7. Confirm signed-out gating behavior matches product expectations

Validation priority for the first pass:

1. iOS simulator
2. Android emulator if time permits

The milestone should prove the app architecture works on both platforms, but should not be blocked on achieving identical polish across both in the first pass.

Automation direction:

- keep current Playwright coverage for web
- add mobile-focused tests later using the standard React Native testing stack for component/integration coverage
- do not block the mobile demo on full mobile E2E automation in the first pass

### Success criteria

- a mobile app can sign in and call the current backend successfully
- the same mobile codebase is viable for both iOS and Android
- existing backend-linked threads are visible and usable on mobile
- mobile can create, load, run, rename, and delete threads against the same backend
- streaming assistant responses work on mobile
- Assisted Learning is reachable on mobile when signed in
- no new backend endpoints are required
- the implementation clearly uses `@assistant-ui/react-native` / native assistant-ui patterns rather than a one-off mobile chat stack

### Open questions for implementation

1. **App shell** — Expo or bare React Native? Recommendation: Expo unless a native dependency forces bare.
2. **Auth integration** — exact Clerk mobile integration path for the chosen shell.
3. **Signed-out baseline** — do we keep anonymous local-only chat on mobile too, or require sign-in immediately?
4. **Thread list UX** — full dedicated screen, drawer, or split navigation?
5. **Assisted Learning UX** — separate stack screen is likely enough for the first pass.

### Recommended implementation order

1. Create the React Native / Expo app shell
2. Prove Clerk sign-in and backend bearer-auth calls from mobile
3. Build thread list + chat thread screens with `@assistant-ui/react-native`
4. Wire remote thread adapter and streaming adapter to the current backend
5. Add Assisted Learning screen
6. Run manual end-to-end parity checks against the current backend

## Milestone 6 (Proposed): Expo Go Rebaseline

**Status:** complete

### Outcome

Milestone 6 successfully re-established Expo Go as the default mobile run path.

What was completed:

- removed app-owned STT UI and runtime from the mobile composer
- kept the app-owned TTS read-aloud UI
- removed speech-recognition-specific native config and Android wiring
- removed the old `react-native-screens` Metro workaround
- revalidated the mobile app manually on the Expo Go path

Validation note:

- manual testing passed after the rebaseline
- the earlier warning-heavy path did not remain the default post-rebaseline

### Follow-on platform maintenance

After the Expo Go rebaseline stabilized, `mobile-v1` was upgraded from Expo SDK 53 to SDK 54 as a separate maintenance step.

What was completed:

- Expo core and bundled mobile dependencies were aligned to the SDK 54 line
- the mobile package tree was reconciled so `package.json` and installed modules match the SDK 54 baseline
- Expo compatibility validation passed with `npx expo install --check` using the local dependency map
- TypeScript validation still passes after the upgrade
- Expo Go path was manually revalidated after the upgrade on both emulator and a real phone
- mobile E2E coverage is now part of the milestone follow-through, so the stabilized Expo Go path is not left as manual-only validation

Remaining caveat:

- Clerk still requires a narrow compatibility patch in the mobile install path; the SDK 54 baseline itself is stable, but the current Clerk package set still exposes an upstream internal runtime mismatch on Expo Go/native without that shim

Next quality step inside this milestone:

- add mobile E2E coverage for the stabilized mobile flows, especially:
  - app boot and auth entry
  - signed-in thread list and chat send path
  - thread sheet open/switch behavior
  - Assisted Learning navigation
  - composer keyboard/scroll behavior on real mobile layouts

Current mobile baseline:

- Expo SDK 54
- React 19.1
- React Native 0.81

Rationale:

- the Expo Go rebaseline and the SDK upgrade were intentionally separated so issues were attributable to one change at a time
- with the rebaseline already stable, SDK 54 could be adopted without mixing platform maintenance into the earlier voice/STT rollback work

### Goal

Return the mobile app to an Expo Go-friendly default development path while preserving the Milestone 5 product and UX progress.

This milestone is a deliberate simplification step:

- remove app-owned speech-to-text from the mobile UI and runtime
- reduce native-module pressure where possible
- recover a lighter-weight mobile iteration loop
- continue mobile product work without making native build friction the default workflow

### Scope

- remove the in-app STT mic button and speech-recognition flow from the chat composer
- remove native STT-specific dependencies and Android project workarounds tied to that path
- restore Expo Go as the default run path for everyday mobile development where feasible
- treat system keyboard dictation (for example Gboard on Android) as the practical speech-to-text fallback
- keep the rest of the mobile shell, thread UX, auth flow, and Assisted Learning work intact

### Keep vs remove

Keep:

- current mobile app shell and navigation structure
- Clerk-based mobile auth direction
- backend-linked thread flows
- Assisted Learning mobile integration
- current chat UX improvements from Milestone 5

Remove or reconsider:

- app-owned STT composer mic path
- native speech-recognition dependency chain
- development-build-only expectation for normal mobile iteration

Open question:

- whether app-owned text-to-speech should remain if it still preserves an Expo Go-friendly path in practice

### Rationale

- Expo Go provides a faster and simpler mobile iteration loop
- app-owned STT introduced enough native dependency complexity to slow down development materially
- keyboard dictation already gives many Android users a workable speech-to-text path without the app owning that feature directly
- first-class app-owned STT can be revisited later as a dedicated milestone, likely with either:
  - a cleaner native-build strategy
  - or a cloud transcription path

### Explicit tradeoff

This milestone prioritizes:

- developer velocity
- simpler mobile setup
- lower native dependency risk

over:

- app-owned speech-to-text as a guaranteed product feature

### Deferred future milestone

If first-class in-app STT becomes important again later, it should return as its own milestone with one of these explicit directions:

- on-device STT via development builds
- cloud STT while preserving Expo Go

That work should be treated similarly to future thread grouping:

- documented and preserved as a roadmap direction
- not forced into the current milestone if it harms the main development path
