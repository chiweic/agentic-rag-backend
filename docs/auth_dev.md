# Auth Step 1 Implementation Brief

## Goal

Implement `app/core/auth.py` as a standalone, reviewable authentication foundation for Milestone 4.

This step does **not** wire auth into thread routes yet. It should only deliver:

- JWT verification for Google-issued ID tokens
- JWKS retrieval and caching
- a FastAPI dependency that returns verified user claims
- clean configuration through `app/core/config.py`
- tests for the auth module in isolation

The output of this step should be safe for review before any thread ownership or route scoping work begins.

## Scope

In scope:

- new module: `app/core/auth.py`
- config additions in `app/core/config.py`
- isolated tests for JWT verification and dependency behavior
- optional small helper types in `app/core/auth.py`

Not in scope:

- modifying `app/api/threads.py`
- adding auth to any router
- DB migrations
- `thread_store` ownership scoping
- Assisted Learning routes
- frontend session handling
- provider expansion beyond Google in M4

## Design Requirements

### Trust boundary

The backend only consumes:

- `Authorization: Bearer <google_id_token>`

The backend must:

- verify token signature using Google JWKS
- verify issuer
- verify audience
- verify expiry
- extract a stable `user_id` from `sub`

The backend must **not**:

- trust user identifiers from arbitrary headers or request bodies
- issue its own session cookies
- manage OAuth redirect flows
- require a Google client secret

### Provider model

M4 uses Google only, but the module should stay multi-provider-ready.

That means:

- do not hardcode Google-specific strings throughout the logic
- keep provider-specific values in config
- structure code so another OIDC provider could be added later with config + thin adapter changes

A simple way to achieve this is:

- generic JWT verification flow
- config-driven issuer / JWKS URL / audience
- Google is just the initial configured provider

No need to build a multi-provider registry in M4. The code just should not paint itself into a corner.

## Expected Public Interface

`app/core/auth.py` should export:

### 1. `UserClaims`

A small typed object for verified identity.

Recommended shape:

```py
from dataclasses import dataclass

@dataclass(frozen=True)
class UserClaims:
    sub: str
    email: str | None
    email_verified: bool | None
    name: str | None
    picture: str | None
    iss: str
    aud: str | list[str]
    exp: int
```

Minimum required field is `sub`. The others are helpful for future product work and logging.

### 2. `verify_bearer_token(token: str) -> UserClaims`

Async or sync is acceptable, but async is preferred if the JWKS fetch path is async.

Behavior:

- verifies JWT signature and claims
- returns `UserClaims` on success
- raises an auth-specific exception on failure

### 3. `get_current_user(...) -> UserClaims`

FastAPI dependency for protected routes.

Behavior:

- reads `Authorization` header
- requires `Bearer <token>`
- verifies the token
- returns `UserClaims`
- raises `HTTPException(status_code=401, ...)` for auth failures

### 4. Optional internal helpers

Examples:

- `parse_bearer_token(authorization_header: str | None) -> str`
- `get_jwks_client()`
- `decode_and_verify_jwt(...)`

These can remain private.

## Config Additions

Add these to `app/core/config.py`:

```py
google_oidc_client_id: str = ""
google_oidc_issuer: str = "https://accounts.google.com"
google_oidc_jwks_url: str = "https://www.googleapis.com/oauth2/v3/certs"
auth_jwks_cache_ttl_seconds: int = 3600
auth_allowed_clock_skew_seconds: int = 30
```

Notes:

- `google_oidc_client_id` is required in environments that enable auth work
- keep defaults for issuer and JWKS URL
- clock skew should be explicit and small
- TTL only needs to control local caching, not long-term persistence

Do **not** add frontend-specific config here.

## Verification Rules

The JWT verifier must enforce:

### Required

- valid signature from the configured JWKS
- `iss` matches configured issuer
- `aud` contains configured client ID
- token is not expired, allowing only the configured small clock skew

### Acceptable defaults

- `sub` must exist and be non-empty
- `email`, `email_verified`, `name`, `picture` are optional

### Failure mapping

All auth failures should become `401` once surfaced through `get_current_user()`.

Examples:

- missing header → `401`
- malformed header → `401`
- invalid signature → `401`
- expired token → `401`
- wrong issuer → `401`
- wrong audience → `401`

Do **not** use `403` in step 1. `403` belongs to route/resource ownership checks later.

## JWKS Caching

Implement an in-process JWKS cache in `app/core/auth.py`.

Requirements:

- cache by JWKS URL
- reuse cached keys until TTL expires
- refetch after TTL
- if verification fails because key ID is missing, allow one forced refresh before final failure

Keep this simple. An in-memory module-level cache is enough for M4.

Suggested internal structure:

```py
_jwks_cache: dict[str, CachedJwks]

@dataclass
class CachedJwks:
    fetched_at: float
    keys: dict
```

No Redis or shared cache is needed.

## Library Expectations

Use a standard JWT/JWK approach already compatible with this backend stack.

Reasonable options:

- `PyJWT` + `PyJWKClient`
- `python-jose`

Recommendation:

- use `PyJWT`, because it is common, simple, and readable for this scope

If `PyJWKClient` is used:

- still wrap it so the rest of the code does not depend on library-specific behavior
- keep the app-facing interface in `auth.py` small and stable
- **keep explicit app-owned JWKS TTL + refresh-on-missing-kid semantics**, even if `PyJWKClient` is used under the hood

## Logging

Use `app.core.logging.get_logger`.

Logging requirements:

- do not log raw JWTs
- do not log full authorization headers
- it is acceptable to log coarse failure reasons at debug/info level
- if useful, log `sub` or email only after successful verification and only where appropriate

For step 1, conservative logging is preferred.

## Tests

Add isolated tests for the auth module before route integration.

Required cases:

1. valid token returns `UserClaims`
2. missing `Authorization` header returns `401` through dependency
3. non-Bearer auth header returns `401`
4. invalid signature returns `401`
5. expired token returns `401`
6. wrong issuer returns `401`
7. wrong audience returns `401`
8. JWKS cache refresh path works when key ID changes

Test strategy:

- do not call live Google endpoints
- do not rely on real Google tokens
- use a fake RSA keypair and fake JWKS in tests
- monkeypatch the JWKS fetch function or HTTP client

This step should leave route-level `401/403/404` matrix tests for later milestones.

## Acceptance Criteria

Step 1 is complete when:

- `app/core/auth.py` exists and is self-contained
- config fields exist in `app/core/config.py`
- `get_current_user()` is ready to be added to FastAPI routes
- auth failures consistently map to `401`
- JWKS caching exists and is covered by tests
- no route files or DB schemas are modified yet
- the code is provider-ready in structure, even though only Google is configured

## Explicit Defaults

These choices should be treated as locked for this step:

- Google OIDC only for M4
- backend consumes bearer ID token only
- no backend sessions
- `401` for all auth failures in this step
- `sub` is the stable future `user_id`
- in-memory JWKS cache is sufficient
- route ownership and `403` checks are deferred to later steps

## Suggested Implementation Order

1. Add config fields in `app/core/config.py`
2. Create `UserClaims` type
3. Implement bearer parsing
4. Implement JWKS fetch + cache
5. Implement JWT verification
6. Implement `get_current_user`
7. Add isolated auth tests
8. Review before touching thread routes

## Review Checklist

Before approving step 1, check:

- no token contents are logged
- audience and issuer are both enforced
- auth errors are normalized to `401`
- cache refresh-on-missing-kid exists
- `sub` extraction is explicit and required
- module interface is small and reusable
- no route or migration logic leaked into the auth module

## Phase 2 Work Items

After step 1 is reviewed and closed, the next backend phase is thread ownership and route protection.

### Goal

Use the verified `UserClaims` from `app/core/auth.py` to enforce per-user ownership on backend thread resources, while keeping OpenAI-compatible and anonymous local-chat paths unchanged.

### Scope

In scope:

- add `user_id` to `thread_metadata`
- migrate existing anonymous thread rows per Milestone 4 plan
- scope all `thread_store` reads/writes by `user_id`
- wire `get_current_user()` into protected thread endpoints
- enforce `401`, `403`, and `404` semantics correctly
- add protected `GET /assisted-learning/modules` stub
- add backend tests for the ownership matrix

Not in scope:

- frontend login flow
- frontend token storage
- auth on `/v1/*`
- API keys for Open WebUI
- RBAC / admin roles

### Required changes

#### 1. Database and store

Update `thread_metadata` persistence:

- add `user_id TEXT`
- delete existing rows where `user_id IS NULL`
- delete orphaned checkpoint state for those deleted thread IDs
- make `user_id` `NOT NULL`
- add index on `(user_id, created_at DESC)`

Update `app/core/thread_store.py`:

- `create_thread(...)` must persist `user_id`
- `get_thread(...)` should support ownership-aware lookup
- `list_threads(...)` must require `user_id`
- `update_thread(...)` and `delete_thread(...)` must be ownership-aware

Recommended interface direction:

- `create_thread(*, user_id: str, metadata: dict | None = None) -> dict`
- `list_threads(user_id: str, include_archived: bool = False) -> list[dict]`
- `get_thread(thread_id: str) -> dict | None`
- route layer decides `403` vs `404` by comparing returned `user_id`

This keeps ownership policy readable at the API layer.

#### 2. Protected thread routes

Update `app/api/threads.py` so protected endpoints depend on `get_current_user()`.

Protected:

- `POST /threads`
- `GET /threads`
- `GET /threads/{id}/state`
- `PATCH /threads/{id}`
- `DELETE /threads/{id}`
- `POST /threads/{id}/runs/stream`
- `POST /threads/{id}/generate-title`

Required semantics:

- missing / invalid / expired bearer → `401`
- thread exists but belongs to another user → `403`
- thread does not exist → `404`
- `POST /threads` stores `user_id = user.sub`
- `GET /threads` returns only caller-owned threads

#### 3. Bearer-less routes must remain unchanged

Do not protect:

- `/v1/*`
- `/api/chat*`
- `/health`

This is a hard boundary for M4.

#### 4. Assisted Learning stub

Add a new router, e.g. `app/api/assisted_learning.py`, with:

- `GET /assisted-learning/modules`

Behavior:

- requires valid bearer via `get_current_user()`
- returns a static module list for now

Minimum module shape:

- `id`
- `title`
- `description`
- `href` or `slug`

### Tests

Add backend tests covering:

1. `401` on protected thread endpoints with:
   - no bearer
   - malformed bearer
   - invalid signature
   - expired token
2. `POST /threads` stores owner `user_id`
3. `GET /threads` returns only caller-owned threads
4. `GET/PATCH/DELETE /threads/{id}`:
   - `403` for wrong owner
   - `404` for unknown thread
5. `POST /threads/{id}/runs/stream`:
   - `403` for wrong owner
   - `404` for unknown thread
6. `GET /assisted-learning/modules`:
   - `200` with valid bearer
   - `401` without bearer

### Acceptance criteria

Phase 2 is complete when:

- all protected thread routes require valid bearer auth
- ownership is enforced consistently via `user_id`
- cross-user access returns `403`
- unknown thread IDs return `404`
- `/v1/*`, `/api/chat*`, and `/health` remain bearer-less
- the Assisted Learning stub is protected and working
- backend tests cover the `401/403/404` matrix

### Current progress

Phase 2 backend coding work is now implemented.

Completed:

- `thread_metadata` ownership migration is in place in [`app/core/thread_store.py`](/home/chiweic/repository/backend/app/core/thread_store.py):
  - `user_id` is added if missing
  - anonymous rows are deleted
  - `(user_id, created_at DESC)` index is created
- startup cleanup in [`app/main.py`](/home/chiweic/repository/backend/app/main.py):
  - `init_store()` returns deleted anonymous thread IDs
  - orphaned checkpoint state for those thread IDs is deleted during startup
- ownership-aware store operations are implemented in [`app/core/thread_store.py`](/home/chiweic/repository/backend/app/core/thread_store.py):
  - `create_thread(user_id=...)`
  - `list_threads(user_id=...)`
  - `update_thread(..., user_id=...)`
  - `delete_thread(..., user_id=...)`
- protected thread routes in [`app/api/threads.py`](/home/chiweic/repository/backend/app/api/threads.py) now use owner-scoped write paths for:
  - delete
  - patch/update
  - generate-title
- protected Assisted Learning stub is present in [`app/api/assisted_learning.py`](/home/chiweic/repository/backend/app/api/assisted_learning.py)
- dedicated Phase 2 auth/ownership tests were added in [`tests/test_thread_auth_phase2.py`](/home/chiweic/repository/backend/tests/test_thread_auth_phase2.py)

Verified:

- `venv/bin/pytest tests/test_thread_auth_phase2.py -q` → `14 passed`
- `venv/bin/pytest tests/test_auth.py tests/test_thread_auth_phase2.py -q` → `24 passed`

Notes:

- broad model-dependent thread tests were not rerun in this pass
- `/v1/*`, `/api/chat*`, and `/health` were not changed by this Phase 2 work

### Phase 2 review results

Phase 1 + Phase 2 reviewed and approved with small fixes applied.

Review verdict: architecture and contract match the M4 plan. 401/403/404 semantics correct, hard boundary on bearer-less routes respected, JWKS cache + refresh-on-missing-kid covered by tests, no token contents logged.

Fixes applied during review:

- **Assisted Learning stub** now returns three real modules with `{id, title, description, href}` shape — frontend can exercise rendering immediately instead of an empty list ([`app/api/assisted_learning.py`](/home/chiweic/repository/backend/app/api/assisted_learning.py))
- **`UserClaims.user_id`** namespaced identifier added — shape is `"{provider}:{sub}"` (e.g. `google:1234567890`). Thread routes now store and query by `user.user_id` instead of raw `user.sub`, so adding a second OIDC provider later is a config-only change with no data migration
- **Issuer→provider mapping** introduced (`_ISSUER_TO_PROVIDER` in [`app/core/auth.py`](/home/chiweic/repository/backend/app/core/auth.py)) — recognises both `https://accounts.google.com` and `accounts.google.com` issuer forms
- **Test fixtures updated** — `_claims` helper and shared conftest now use the real Google issuer so `user.user_id` resolves correctly; a `_uid()` helper keeps cross-user ownership assertions consistent
- **Dead code** (`_set_test_user`) removed from [`tests/test_thread_auth_phase2.py`](/home/chiweic/repository/backend/tests/test_thread_auth_phase2.py)

Verified after fixes:

- `venv/bin/pytest -q` → `53 passed`
- `venv/bin/ruff check app/core/auth.py app/api/assisted_learning.py` → clean

Deferred (non-blocking):

- **JWKS outage behaviour** — if Google's JWKS endpoint is unreachable after the cache TTL expires, every auth request will 401. Logged as operational risk; current "simple module-level cache" is what the M4 plan specified
- **Double DB round-trips** in `get_thread_state` / `run_stream` / `generate_title` (ownership check then re-fetch state) — functional, not worth optimising until it shows up in traces
- **`HTTPBearer` wrong-scheme behaviour** — in direct unit tests a non-Bearer scheme surfaces through our dependency as 401, but in a real HTTP request FastAPI's `HTTPBearer(auto_error=False)` passes `None` through and we still end up at 401; net effect is correct, just a worth-knowing nuance

## Phase 3: frontend auth integration + protected UX

Backend side is feature-complete for M4 (Phases 1+2). Phase 3 is the frontend vertical slice that makes the auth surface visible to users and exercises the full contract end-to-end.

### Goal

Enable a signed-in user to see their own backend-linked threads, create new ones, render the Assisted Learning page, and sign out cleanly — with signed-out users still able to use local-only chat through `/v1/chat/completions`.

### Scope (frontend-led, backend supports)

Frontend work:

- Google OIDC flow via Authorization Code + PKCE against Google directly
- token storage in `sessionStorage` per F1
- dedicated `/login` route per F2
- `Authorization: Bearer <id_token>` attached to every request to `/threads*` and `/assisted-learning/*`
- logout clears `sessionStorage` and wipes persisted Zustand thread state per F3
- nav entry for Assisted Learning hidden when unauthenticated; page calls `GET /assisted-learning/modules` and renders the returned list
- signed-out baseline: local-only chat via `/v1/chat/completions` keeps working per F6
- on token expiry the user is treated as signed out (no silent refresh in M4 per F1)

Backend-side support work (should be minimal):

- confirm CORS allows the frontend origin to send `Authorization` header (currently `allow_origins=["*"]` + `allow_headers=["*"]`, so fine)
- confirm `401` responses do not include sensitive detail strings that would leak info
- `GET /me` is optional and post-M4 unless frontend explicitly needs it before implementation; if added, `{user_id, email, name, picture, provider}` is sufficient
- document the exact 401/403 response bodies in `docs/api_reference.md` so the frontend error-handling path is predictable

### Non-goals (Phase 3)

- refresh tokens / silent re-auth
- GitHub or any second provider
- RBAC / per-user feature flags
- auth on `/v1/*`
- email allowlist

### Open questions for frontend (Phase 3 kickoff)

1. **`GET /me` shape** — frontend confirms `{user_id, email, name, picture, provider}` is sufficient for M4 if this route is added later.
2. **Route guarding** — only Assisted Learning should be frontend-gated in M4. Signed-out baseline chat remains available. Linked-thread API calls may return `401`, and frontend should react at the UX layer rather than hiding the whole app.
3. **Linked-thread reconciliation across sign-in** — frontend confirms anonymous local-only threads are discarded on sign-in in M4; no linking/import flow.
4. **Error UX for 401 on a backend-linked thread** — frontend preference is inline banner/error state plus redirect to `/login` on next explicit user action, avoiding automatic redirect loops.
5. **Testing** — do not run Playwright against real Google sign-in. Use a dev/test token path instead.

### Success criteria

- signed-in user completes the `/login` flow and lands back on the app with a valid bearer in `sessionStorage`
- `POST /threads` and `POST /threads/{id}/runs/stream` both succeed with the bearer attached
- Assisted Learning page renders the three backend stub modules
- signed-out user can still chat via `/v1/chat/completions` (baseline intact)
- logout removes token, clears local threads, redirects to signed-out baseline
- expired/invalid tokens surface as 401 and the frontend reacts gracefully (no infinite loop)
- Playwright E2E covers: signed-in thread create + run, signed-out baseline chat, signed-out Assisted Learning gating, logout flush

### Suggested order for Phase 3 work

1. Backend: add optional `GET /me` + document 401/403 bodies in `api_reference.md`
2. Backend: add `AUTH_DEV_MODE` test-signer support (off by default) so frontend E2E can mint test tokens
3. Frontend: `/login` route + Google OIDC PKCE flow
4. Frontend: bearer attachment for `/threads*` + `/assisted-learning/*`
5. Frontend: Assisted Learning page
6. Frontend: logout + state wipe
7. Joint: Playwright E2E covering the success criteria above

### Current Phase 3 status

Phase 3 is still pending backend review before frontend implementation starts.

What is already true:

- backend auth foundations are complete from Phases 1 and 2
- protected thread routes and Assisted Learning route already exist
- Assisted Learning backend stub already returns three modules with `{id, title, description, href}`
- frontend preferences for session model, login route, logout behavior, signed-out baseline, and M4 auth UX are now recorded here

What is still waiting on backend review:

- whether `GET /me` should be added for M4 or deferred
- whether `AUTH_DEV_MODE` or equivalent test-token support is the preferred way to support frontend Playwright auth coverage
- final confirmation that `docs/api_reference.md` should document exact `401` / `403` error bodies before frontend starts

### Backend decisions on Phase 3 support work

**Decision 1: `GET /me` — deferred to post-M4.**

Frontend confirmed `/me` is optional for M4. Rationale for deferring:

- the Google ID token already contains `email`, `name`, `picture` in its payload; frontend can decode the JWT client-side (no verification needed — frontend trusts the token it is already holding) and populate the account menu directly from that
- backend `user_id` is derivable on the frontend as `"google:" + decodedJwt.sub` without a backend call
- `provider` is always `"google"` in M4
- an extra endpoint costs contract surface, a test, and a round-trip on every page load for zero frontend blocker
- if a second provider lands, or `user_id` namespacing changes, `/me` becomes the right abstraction and gets added then

Action: document JWT-decode approach for user profile in `api_reference.md` under the auth section.

**Decision 2: `AUTH_DEV_MODE` + dev test-token endpoint — will be built.**

Playwright cannot reliably automate real Google sign-in (captchas, 2FA, iframe flakiness). A scoped dev-only signer is the standard solution.

Design:

- new config flag `AUTH_DEV_MODE: bool = False`, default off, must be explicitly enabled per environment
- when enabled, backend generates a fresh RSA keypair at process startup (not persisted to disk — prevents accidental leak via repo checkout)
- dev public JWK is injected into the JWKS cache under a dev-only issuer (`iss: "https://dev.local"`) that is intentionally distinct from Google's, so a leaked dev token can never be confused with a real Google token in verification logs
- new helper endpoint `POST /auth/dev-token` available **only** when `AUTH_DEV_MODE=True`; returns a signed test JWT for a given `sub`/`email`
- when `AUTH_DEV_MODE=False`, `/auth/dev-token` returns `404` (not `403`) so prod probes cannot discover the endpoint's existence
- startup logs a loud warning when dev mode is on
- dev-signed tokens go through the exact same verifier as Google tokens — no special-case bypass in `get_current_user`

**Decision 3: document `401` / `403` / `404` response bodies in `api_reference.md`.**

Current shapes:

- `401` → `{"detail": "<reason>"}` where reason is one of: `"Missing or invalid authentication scheme"`, `"Token is expired"`, `"Invalid token issuer"`, `"Invalid token audience"`, `"Invalid token signature or claims"`, `"Missing key ID in token"`, `"Key ID not found in JWKS"`, `"Missing subject in token"`, `"Malformed token header"`
- `403` → `{"detail": "Forbidden"}`
- `404` → `{"detail": "Thread not found"}`

For M4 these stay as-is (aids debugging). Pre-production, the 401 detail strings will collapse to a generic `"Unauthorized"` to avoid leaking which verification step failed. This tightening will be tracked as a hardening item, not part of M4.

### Backend Phase 3 work order

1. Document `401` / `403` / `404` response bodies and JWT-decode-for-profile approach in `docs/api_reference.md`
2. Build `AUTH_DEV_MODE` + `POST /auth/dev-token` endpoint; extend JWKS lookup to accept the dev key alongside Google
3. Skip `GET /me`

## Phase 4: Frontend Auth Integration

### Summary

Phase 4 is the first primarily frontend-heavy milestone after the backend auth,
ownership, and dev-token foundations from M4 are in place.

Goal:

- make auth visible and usable in the frontend
- preserve the current signed-out local-only chat baseline
- enable signed-in access to backend-linked threads and Assisted Learning

### Ownership

Frontend is the primary implementation owner for Phase 4.

Backend involvement should be limited to:

- reviewing integration questions if they arise
- keeping the documented auth contract stable
- only making small follow-up fixes if frontend integration reveals a real gap

No new backend feature work is assumed as a prerequisite beyond what is already
implemented for M4.

### Scope

Frontend work:

- add a dedicated `/login` route
- implement Google OIDC Authorization Code + PKCE flow
- store the Google ID token in `sessionStorage`
- attach `Authorization: Bearer <id_token>` to:
  - `/threads*`
  - `/assisted-learning/*`
- keep signed-out local-only chat working via `/v1/chat/completions`
- hide Assisted Learning navigation when signed out
- add logout that:
  - clears `sessionStorage`
  - clears persisted Zustand thread state
  - returns user to the signed-out baseline
- handle `401` on linked-thread and Assisted Learning requests gracefully
- add frontend E2E coverage for the signed-in and signed-out paths

Backend assumptions for frontend integration:

- `/threads*` remains protected by bearer auth
- `/assisted-learning/modules` remains protected by bearer auth
- `/v1/*`, `/api/chat*`, and `/health` remain bearer-less
- `AUTH_DEV_MODE` + `POST /auth/dev-token` can be used for Playwright / integration testing

### Non-goals

- refresh-token rotation or silent re-auth
- GitHub or any second auth provider
- RBAC / per-user feature flags
- protecting `/v1/*`
- importing anonymous local threads into authenticated accounts

### Success criteria

- signed-in user completes login and lands back in the app with a valid bearer in `sessionStorage`
- signed-in user can create and use backend-linked threads successfully
- signed-in user can open Assisted Learning and render the protected module list
- signed-out user can still use local-only chat
- logout removes auth state and local persisted thread state
- expired or invalid tokens surface as `401` and frontend handles that without redirect loops
- frontend Playwright coverage exists for:
  - signed-in thread flow
  - signed-out local-only baseline
  - Assisted Learning gating
  - logout cleanup

### Current status

Phase 4 frontend auth integration is implemented and verified.

Completed:

- frontend auth state is stored in `sessionStorage`
- dedicated `/login` route exists
- signed-out baseline local-only chat remains working
- signed-in requests attach `Authorization: Bearer <id_token>` to protected backend routes
- Assisted Learning has a protected frontend page
- logout clears auth state and persisted thread state
- frontend dev-token auth flow is wired for Playwright / integration testing

Frontend files involved:

- [`frontend-v1/lib/auth-store.ts`](/home/chiweic/repository/backend/frontend-v1/lib/auth-store.ts)
- [`frontend-v1/lib/auth-client.ts`](/home/chiweic/repository/backend/frontend-v1/lib/auth-client.ts)
- [`frontend-v1/lib/backend-threads.ts`](/home/chiweic/repository/backend/frontend-v1/lib/backend-threads.ts)
- [`frontend-v1/lib/assisted-learning.ts`](/home/chiweic/repository/backend/frontend-v1/lib/assisted-learning.ts)
- [`frontend-v1/app/login/page.tsx`](/home/chiweic/repository/backend/frontend-v1/app/login/page.tsx)
- [`frontend-v1/app/assisted-learning/page.tsx`](/home/chiweic/repository/backend/frontend-v1/app/assisted-learning/page.tsx)
- [`frontend-v1/app/MyRuntimeProvider.tsx`](/home/chiweic/repository/backend/frontend-v1/app/MyRuntimeProvider.tsx)
- [`frontend-v1/components/assistant-ui/thread-list-sidebar.tsx`](/home/chiweic/repository/backend/frontend-v1/components/assistant-ui/thread-list-sidebar.tsx)

Verified:

- `npx tsc --noEmit` in [`frontend-v1`](/home/chiweic/repository/backend/frontend-v1) passes
- Playwright E2E suite passes with backend `AUTH_DEV_MODE=True`

Result:

- current M4 auth work is complete end-to-end for the agreed scope
- further auth work is optional follow-up/hardening, not required to finish the current milestone

### Backend Phase 3 status: complete

All three backend work items above are landed. Frontend is unblocked to start Phase 3 implementation.

**Completed:**

- **Provider registry refactor** in [`app/core/auth.py`](/home/chiweic/repository/backend/app/core/auth.py):
  - token verifier now routes by the token's `iss` claim to the matching registered `Provider`
  - Google provider is registered from existing config
  - dev provider (when `AUTH_DEV_MODE=True`) generates a fresh in-process RSA keypair, injects the public JWK under `iss: "https://dev.local"`, and never writes its private key to disk
  - `UserClaims.provider` resolves to `"google"` or `"dev"` based on `iss`; `user_id` becomes `"dev:<sub>"` for dev tokens, isolated from `"google:<sub>"` identities
  - dev key cannot masquerade as a Google token (issuer-routing means a token claiming `iss=google` is looked up in Google's JWKS, not the dev keys)

- **Config flags** in [`app/core/config.py`](/home/chiweic/repository/backend/app/core/config.py):
  - `auth_dev_mode: bool = False` (default off, must be explicitly enabled)
  - `auth_dev_issuer: str = "https://dev.local"`

- **Dev-token endpoint** in [`app/api/auth_dev.py`](/home/chiweic/repository/backend/app/api/auth_dev.py):
  - `POST /auth/dev-token` with body `{sub, email?, name?, ttl_seconds?}` → returns `{access_token, token_type, expires_in}`
  - router is only mounted when `AUTH_DEV_MODE=True`; returns `404` otherwise (prod probes cannot discover existence)
  - Pydantic input validation: `sub` 1–128 chars, `ttl_seconds` 1–86400

- **Startup integration** in [`app/main.py`](/home/chiweic/repository/backend/app/main.py):
  - `init_providers()` is called at lifespan start
  - dev router is conditionally included based on `settings.auth_dev_mode`
  - loud warning logged when dev mode is active

- **Tests** in [`tests/test_auth_dev_mode.py`](/home/chiweic/repository/backend/tests/test_auth_dev_mode.py): 5 new tests — endpoint issues usable JWT, minted token verifies via standard verifier, `mint_dev_token` raises when dev mode off, `/auth/dev-token` returns 404 in default app, dev key cannot masquerade as Google

- **`docs/api_reference.md` Authentication section** documents: bearer contract + bearer-less routes, `user_id` derivation via client-side JWT decode (no `/me` needed), complete list of 401 detail strings, 403/404 shapes, `AUTH_DEV_MODE` + `POST /auth/dev-token` endpoint contract

**Verified:**

- `venv/bin/pytest -q` → `58 passed`
- `venv/bin/ruff check app/core/auth.py app/api/auth_dev.py app/core/config.py tests/test_auth_dev_mode.py` → clean

**How frontend uses this:**

- in Playwright / E2E, run the backend with `AUTH_DEV_MODE=True` (env var)
- call `POST /auth/dev-token` with a test `sub` at the start of each test to get a bearer
- attach that bearer to `/threads*` and `/assisted-learning/*` requests exactly as if it were a Google token
- the `user_id` seen on backend for those tests will be `"dev:<sub>"`, so tests should not cross-check against real user data

**How to populate the account menu (no `/me`):**

- after Google sign-in, frontend already holds the ID token (a JWT)
- decode the JWT payload client-side (base64url decode the middle segment — no signature check needed, frontend trusts its own token)
- payload contains `sub`, `email`, `name`, `picture`
- derive the backend `user_id` as `"google:" + payload.sub` if needed
- see `docs/api_reference.md` Authentication section for the reference contract

## Phase 5: Full Register / Login / Logout With Clerk

Phase 5 is the first auth expansion beyond the current M4 bearer-token baseline. The goal is to replace the current direct Google/dev-token frontend flow with a production-ready full authentication system that supports user registration, sign-in, sign-out, and provider-managed account UX with minimal custom auth code.

This section is now an implementation-ready plan, not just a recommendation.

### Recommendation

Use **Clerk** as the auth framework for Phase 5.

Why Clerk is the preferred path for this repo:

- fastest path to full register / login / logout without building password auth ourselves
- supports Google social sign-in and email/password flows out of the box
- strong Next.js App Router support
- frontend can still obtain a bearer token and send it to the FastAPI backend
- avoids building password hashing, reset flows, verification emails, and account-linking ourselves
- keeps Postgres as the app database for thread / learning / domain data

What Clerk does **not** replace:

- app-owned Postgres data
- backend ownership checks on `/threads*`
- Assisted Learning authorization decisions
- app domain models and persistence

### Locked Defaults

These decisions should be treated as the Phase 5 defaults unless explicitly changed:

- Clerk is the end-user auth framework
- Postgres remains the app database
- Clerk is responsible for registration, login, logout, and account UX
- backend remains a bearer-token verifier and resource owner
- `/v1/*` remains bearer-less in Phase 5
- `AUTH_DEV_MODE` stays available for Playwright and backend tests
- production end-user auth should not keep the current custom Google/dev flow in parallel longer than needed
- backend identity format for Clerk users should be `clerk:<sub>`
- the current custom `/login` page should become a thin redirect/wrapper to Clerk sign-in, not remain a separate bespoke auth UI
- Phase 5 should keep signed-out anonymous local-only chat unless product later decides auth must gate the whole app
- Phase 5 should launch with Google sign-in first inside Clerk; email/password can be enabled in Clerk in the same phase only if product wants it immediately

### Phase 5 Goal

Deliver a complete production-facing auth UX with:

- registration
- login
- logout
- social sign-in (Google)
- optional email/password sign-in
- authenticated frontend session UX
- continued backend bearer verification and user ownership enforcement

### Architecture Direction

#### Frontend

Frontend becomes Clerk-powered:

- use Clerk's Next.js integration for sign-up, sign-in, sign-out, and session state
- replace the current custom `/login` implementation with Clerk-hosted or Clerk-rendered auth UI
- use Clerk session/token APIs to obtain a bearer token for backend requests
- continue attaching `Authorization: Bearer <token>` to protected backend routes

#### Backend

Backend remains bearer-token consumer and resource owner:

- verify Clerk-issued tokens instead of only raw Google/dev tokens
- continue deriving stable `user_id` from verified claims
- continue enforcing per-user ownership on threads and Assisted Learning routes
- keep `/v1/*` bearer-less unless a later milestone changes that

#### Database

App database remains **Postgres**.

Clerk is the auth provider, not the app database. App-owned records such as threads, learning content, and other domain data stay in Postgres.

### Scope

In scope:

- adopt Clerk in `frontend-v1`
- replace the custom direct Google login flow for end users
- support full register / login / logout UX
- preserve protected backend fetches with bearer tokens
- adapt backend auth verification to Clerk-issued tokens
- keep thread ownership model working against Clerk user identity
- preserve signed-out baseline behavior only if product still wants anonymous local-only chat after Clerk rollout

Not in scope:

- RBAC / admin roles
- organization support
- GitHub provider unless explicitly added later
- moving app data out of Postgres
- protecting `/v1/*` for Open WebUI in this phase unless explicitly re-decided

### Implementation Order

#### 1. Frontend Clerk baseline

- install and configure Clerk in `frontend-v1`
- add Clerk provider at app root
- add Clerk middleware/provider wiring required for App Router
- replace current custom login route/UI with Clerk sign-in / sign-up flow
- add authenticated account menu / sign-out flow
- update protected pages and sidebar auth UI to use Clerk session state
- keep signed-out anonymous local-only chat working

#### 2. Backend Clerk token verification

- extend `app/core/auth.py` to verify Clerk-issued bearer tokens
- keep provider registry structure so Clerk becomes another configured provider instead of a one-off path
- derive stable backend `user_id` as `clerk:<sub>`
- confirm cross-user thread ownership logic continues to work with the new `user_id` format
- keep Google/dev provider support only as long as necessary for test and migration support

#### 3. Session and bearer contract alignment

- define which Clerk token the frontend sends to FastAPI
- document exact bearer contract in `docs/api_reference.md`
- confirm frontend protected fetch wrappers use that token consistently for:
  - `/threads`
  - `/threads/{id}/state`
  - `/threads/{id}/runs/stream`
  - `/assisted-learning/modules`

#### 4. Frontend protected UX migration

- migrate the current `/login` page into a Clerk redirect/wrapper
- update sidebar signed-in / signed-out state to use Clerk session state
- keep Assisted Learning protected
- preserve logout behavior:
  - sign out from Clerk
  - clear local persisted thread state
  - return to signed-out baseline

#### 5. Compatibility cleanup

- use Clerk as the only production end-user auth path
- keep `AUTH_DEV_MODE` only for Playwright / tests
- remove or clearly fence off any old direct Google frontend login code once Clerk flow is stable
- update docs so the production auth path is no longer ambiguous

### Success Criteria

Phase 5 is complete when:

- users can register, sign in, and sign out through Clerk
- frontend protected routes and protected fetches work with Clerk session/token state
- backend verifies Clerk bearer tokens successfully
- thread ownership remains correct across users
- Assisted Learning remains protected and usable
- current tests are updated, and auth E2E coverage passes with the new flow
- `AUTH_DEV_MODE` remains available for automated tests unless intentionally replaced with another safe test strategy

### Required Deliverables

Frontend:

- Clerk installed and configured in `frontend-v1`
- app root wrapped with Clerk provider
- `/login` route updated to hand off to Clerk
- sidebar/account UI updated to reflect Clerk auth state
- protected fetch helpers use Clerk bearer token
- logout clears local persisted app state

Backend:

- Clerk verification support added in `app/core/auth.py`
- backend user identity derived as `clerk:<sub>`
- protected routes continue to enforce ownership correctly
- `docs/api_reference.md` updated with Clerk bearer contract

Testing:

- backend tests cover Clerk-issued token verification
- frontend Playwright coverage passes with a safe test auth path
- existing protected thread and Assisted Learning flows still pass under the new auth path

### Risks / Watchpoints

- do not accidentally break the current local-only signed-out chat baseline unless product explicitly changes that requirement
- do not keep two production auth paths longer than necessary
- ensure backend ownership checks cannot confuse `google:<sub>`, `dev:<sub>`, and `clerk:<sub>`
- ensure Clerk token choice is documented clearly before frontend integration starts, so the backend verifies the correct token type
- keep `AUTH_DEV_MODE` test-only; it must not become an end-user production path

### Current Progress

Phase 5 coding has started with a compatibility-first slice.

Implemented:

- frontend Clerk package added in [`frontend-v1/package.json`](/home/chiweic/repository/backend/frontend-v1/package.json)
- Clerk provider bridge added in [`frontend-v1/components/auth/app-auth-provider.tsx`](/home/chiweic/repository/backend/frontend-v1/components/auth/app-auth-provider.tsx)
- app root now wraps frontend with the auth provider in [`frontend-v1/app/layout.tsx`](/home/chiweic/repository/backend/frontend-v1/app/layout.tsx)
- frontend auth store now supports external auth/session sync and token invalidation hooks in [`frontend-v1/lib/auth-store.ts`](/home/chiweic/repository/backend/frontend-v1/lib/auth-store.ts)
- backend fetch helpers now obtain bearer tokens through the shared auth resolver in [`frontend-v1/lib/backend-threads.ts`](/home/chiweic/repository/backend/frontend-v1/lib/backend-threads.ts)
- `/login` is Clerk-first when configured, with legacy flow kept as fallback in [`frontend-v1/app/login/page.tsx`](/home/chiweic/repository/backend/frontend-v1/app/login/page.tsx)
- new `/register` route added in [`frontend-v1/app/register/page.tsx`](/home/chiweic/repository/backend/frontend-v1/app/register/page.tsx)
- sidebar auth controls updated for Clerk-aware sign-in/register/logout in [`frontend-v1/components/assistant-ui/thread-list-sidebar.tsx`](/home/chiweic/repository/backend/frontend-v1/components/assistant-ui/thread-list-sidebar.tsx)
- backend auth provider registry now accepts Clerk issuer/JWKS configuration in [`app/core/auth.py`](/home/chiweic/repository/backend/app/core/auth.py) and [`app/core/config.py`](/home/chiweic/repository/backend/app/core/config.py)
- focused backend auth coverage now includes a Clerk verification case in [`tests/test_auth.py`](/home/chiweic/repository/backend/tests/test_auth.py)
- Clerk/frontend/backend env examples and bearer contract docs updated in:
  - [`frontend-v1/.env.example`](/home/chiweic/repository/backend/frontend-v1/.env.example)
  - [`frontend-v1/README.md`](/home/chiweic/repository/backend/frontend-v1/README.md)
  - [`.env.example`](/home/chiweic/repository/backend/.env.example)
  - [`docs/api_reference.md`](/home/chiweic/repository/backend/docs/api_reference.md)

Verified:

- `npx tsc --noEmit` in [`frontend-v1`](/home/chiweic/repository/backend/frontend-v1) passes
- `venv/bin/pytest tests/test_auth.py tests/test_auth_dev_mode.py -q` → `16 passed`
- `npm run test:e2e` in [`frontend-v1`](/home/chiweic/repository/backend/frontend-v1) passes with backend `AUTH_DEV_MODE=True`
- Playwright regression coverage now explicitly includes:
  - signed-out baseline chat
  - signed-out Assisted Learning gating
  - linked-thread metadata hydration after reload
  - mixed linked/local thread reload behavior
  - dev-token sign-in + logout flow
  - reopen linked thread after logout/login without sending a new message
- manual Clerk validation completed locally:
  - register works
  - login works
  - logout works
- manual protected-flow validation completed locally:
  - signed-in Assisted Learning fetch works
  - signed-in thread create/run works against protected `/threads*`
  - linked-thread reload/history hydration works
  - signed-out fallback chat still works
  - signed-out Assisted Learning gating still works
  - reopen linked thread after logout/login now loads history correctly without sending a new message

Status:

- Current auth milestone is complete
- Phase 5 core implementation is complete for the currently agreed scope
- Clerk support is now working on both frontend and backend
- env/config contract for Clerk issuer, JWKS, authorized parties, and optional frontend JWT template is now documented
- legacy M4 fallback behavior remains available where intentionally preserved
- current Clerk instance is still in development mode, which is acceptable for local development but not the final production configuration

Milestone result:

- completed:
  - backend bearer verification foundation
  - per-user thread ownership enforcement
  - protected Assisted Learning backend route
  - frontend signed-out baseline + protected UX
  - dev-token test path
  - Clerk-based register / login / logout
  - Clerk-backed protected thread + Assisted Learning flows
- verified:
  - backend auth tests pass
  - frontend typecheck passes
  - frontend Playwright E2E passes, including the auth-boundary linked-thread reopen regression
  - manual end-to-end validation passed for register, login, logout, protected thread flow, Assisted Learning, linked-thread reload, and signed-out fallback
- known accepted behavior:
  - for backend-linked threads, the sidebar can briefly show `0 messages Linked` after login/reload until the user opens the thread
  - this is a consequence of metadata-only thread list hydration plus lazy `/threads/{id}/state` loading
  - this is acceptable for the current dev/test UI because the production UI is expected to hide that status line
- deferred follow-up:
  - move Clerk from development mode to production instance/domain
  - optional removal of legacy fallback auth code after product confirms it is no longer needed

### Recommendation Summary

If the goal is the fastest safe path to a real production auth system, **Clerk is the recommended framework for Phase 5**.

It gives us:

- full auth UX quickly
- less auth code to maintain
- better default security posture than building password auth ourselves
- clean fit with the current Next.js frontend + FastAPI backend split

The main tradeoff is vendor dependence, but for this repo that is likely worth it compared with continuing to expand custom auth flows.
