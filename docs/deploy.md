# Deployment Work Tracker

Shipping the current demo build (branch `claude/v4-whats-new`) to a limited public audience, then hardening for "real" production.

**Status legend**
- ⬜ not started
- 🟡 in progress
- ✅ done
- ⛔ blocked (note the blocker in the item body)

Keep items terse; link to commits / PRs / configs as they happen.

---

## Phase A — Minimal public demo

Goal: a single URL a small invited audience can hit, with auth and HTTPS. Not production-grade; acceptable for vetted users.

### A1. HTTPS + public hostname ⬜

Pick one:
- **Reverse proxy** on a VPS: Caddy or nginx in front of `uvicorn` (backend) + `next start` (frontend). Caddy gets ACME certs automatically.
- **PaaS**: Vercel (frontend) + Fly.io / Railway / Render (backend). Easier ops, adds per-vendor config.

Decision needed before the rest of Phase A. Vercel + Fly is probably fastest for a first demo; single-VPS + Caddy is cheapest if there's already an SSH'able box.

**Touchpoints**: none in the codebase yet — this is infra. Output is a public URL + the backend URL the frontend should call.

### A2. CORS pinning ⬜

Today [app/main.py:138](/mnt/data/backend/app/main.py) has:
```python
allow_origins=["*"]
```
Swap to a `cors_allowed_origins: list[str]` setting (pydantic-settings, comma-separated env) and inject in the `CORSMiddleware`. Default to `["*"]` in dev / empty in prod so misconfiguration fails closed.

**Touchpoints**: [app/main.py](/mnt/data/backend/app/main.py), [app/core/config.py](/mnt/data/backend/app/core/config.py).

### A3. Auth story for the demo ⬜

Logto currently runs at `192.168.50.253:3302` (LAN-only). `AUTH_DEV_MODE=true` is not safe outside LAN. Options:

- **Expose Logto publicly** behind the same HTTPS reverse proxy. Still self-hosted; requires registering production redirect URIs in the Logto admin panel.
- **Switch to a SaaS OIDC** (Logto Cloud, Clerk, Auth0). Fastest; needs env swap + updated `LOGTO_*` / `google_oidc_*` settings.
- **Keep `AUTH_DEV_MODE=true`** but IP-allowlist at the reverse proxy. Ugly but workable for a tiny closed demo.

Pick one; document the chosen flow.

**Touchpoints**: [frontend/.env.local](/mnt/data/backend/frontend/.env.local), [frontend/lib/logto.ts](/mnt/data/backend/frontend/lib/logto.ts), [app/core/auth.py](/mnt/data/backend/app/core/auth.py).

#### A3a. Logto reconfig checklist (after spinning up a new Logto instance)

Use this when Logto's DB is reset, the container is recreated, or you move Logto to a new host.

**In the new Logto admin console** (`http://<logto-host>:3301`):
1. **Applications → Create**: pick "Traditional web" (Next.js). Record the new `App ID` and `App Secret`.
2. On the new app's settings page:
   - **Redirect URIs** → `<frontend-base-url>/api/auth/callback` (e.g. `http://192.168.50.253:3000/api/auth/callback`).
   - **Post sign-out redirect URIs** → `<frontend-base-url>` (plain, no `/api/...`).
3. **API resources → Create**: identifier any stable string. Keeping `https://api.myapp.local` avoids touching anything code-side.
4. Back on the Application, under **Permissions**, add the API resource so issued tokens carry the correct `aud`.

**Backend `.env`** (verifies the JWT; see [app/core/auth.py](/mnt/data/backend/app/core/auth.py)):

```
LOGTO_OIDC_ISSUER=http://<new-logto-host>:<port>/oidc
LOGTO_OIDC_JWKS_URL=http://<new-logto-host>:<port>/oidc/jwks
LOGTO_OIDC_AUDIENCE=<API resource identifier from step 3>
```

**Frontend `frontend/.env.local`** (sign-in flow; see [frontend/lib/logto.ts](/mnt/data/backend/frontend/lib/logto.ts)):

```
LOGTO_ENDPOINT=http://<new-logto-host>:<port>
LOGTO_APP_ID=<from step 1>
LOGTO_APP_SECRET=<from step 1>
LOGTO_BASE_URL=<where the frontend is actually served; must match the browser URL>
LOGTO_COOKIE_SECRET=<any random string; changing invalidates existing sessions>
LOGTO_RESOURCE=<same value as LOGTO_OIDC_AUDIENCE>
```

**Then**:
- Restart backend (`uvicorn`) and frontend (`npm run dev`).
- Clear old `logto_*` cookies in the browser (or use incognito) — otherwise sign-in lands on `/unknown-session`.

**Gotchas**:
- `LOGTO_BASE_URL` must match the browser's URL for the frontend exactly — if the browser hits the LAN IP but `LOGTO_BASE_URL` is `localhost`, post-sign-in + sign-out redirects break.
- `LOGTO_RESOURCE` (frontend) and `LOGTO_OIDC_AUDIENCE` (backend) must be the same exact string. Any drift → backend 401s every request.

### A4. Production env files ⬜

`frontend/.env.local` has `LOGTO_ENDPOINT=http://192.168.50.253:3302` and `LOGTO_BASE_URL=http://192.168.50.253:3100` — LAN-specific. Root `.env` has `MILVUS_HOST=localhost`, `POSTGRES_URI=` (empty), etc.

Produce two env templates:
- `.env.example` (root) — annotate each var with "dev default" / "prod required".
- `frontend/.env.example` — prod LOGTO_* + any `NEXT_PUBLIC_*` switches.

Copy + fill for the deployment target. Confirm pydantic-settings `extra="ignore"` still catches typos.

**Touchpoints**: [app/core/config.py](/mnt/data/backend/app/core/config.py), [frontend/.env.example](/mnt/data/backend/frontend/.env.example) (create if missing), new `.env.example` at repo root.

### A5. Thread-store Postgres ⬜

`POSTGRES_URI` currently empty → in-memory thread store + checkpointer (OK for CI; lethal for a demo — threads vanish on restart). Phase A needs a managed Postgres (Supabase / Neon / RDS / plain VPS PG).

[app/main.py](/mnt/data/backend/app/main.py) already picks the Postgres path when the URI is non-empty; just set the env and the lifespan does the right thing. Migration happens automatically via `init_store()`.

**Touchpoints**: env only (`POSTGRES_URI`). Verify `thread_metadata` and checkpointer tables land on first boot.

### A6. rag_bot packaging ⬜

`rag_bot` is installed via `pip install -e /mnt/data/rag_bot` today — path-specific. The deployment host won't have that path. Options:

- Publish `rag_bot` to a private PyPI / a git ref, install via `pip install rag_bot@git+…`.
- Vendor it into the deployment image (monorepo-style, single Dockerfile that COPYs both).
- Keep it editable but COPY the rag_bot source into the build context.

Easiest first pass: git-ref install in requirements.

**Touchpoints**: `pyproject.toml` deps, deployment image definition (not yet written).

### A7. Milvus reachable from deployed backend ⬜

`settings.milvus_host` currently `localhost` in the repo default. Production options:

- **Zilliz Cloud** — managed Milvus, swap in a URI + token.
- **Self-hosted Milvus** — same box as backend (docker compose) or a peered instance.

Credentials go into `MILVUS_*` env vars. The existing `milvus_secure` / `milvus_token` settings already handle the Zilliz case.

The manifest files at `/mnt/data/rag_bot/data/datasets/*` also need to be reachable — either mounted or shipped alongside the backend image.

**Touchpoints**: env only for the connection; deployment artifact definition needs to include or mount the rag_bot data directory (or replicate it via S3).

### A8. LLM vendor keys ⬜

`GEN_LLM` / `SUGGEST_LLM` env vars resolve via `rag_bot.llm_config.resolve`. For prod: confirm the picked vendor, provision a key, set `{VENDOR}_API_KEY` / `{VENDOR}_BASE_URL` / `{VENDOR}_MODEL` triples.

Langfuse env vars (`LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_BASE_URL`) — same story.

**Touchpoints**: env only.

### A9. Smoke the full flow end-to-end ⬜

Once A1–A8 are in place:
1. Sign in via Logto on the public URL.
2. Main chat: send a message, verify citations render.
3. `/events`: recommendation card click fires a turn.
4. `/sheng-yen`: audio plays, YouTube card opens iframe, citations show.
5. `/whats-new`: Google News headlines appear (first load ~500ms), suggestions fire chat.
6. Deep Dive overlay on a main-chat citation opens + scoped chat works.
7. Quiz dialog from Deep Dive generates MCQ.
8. Thumbs up/down persists across reload (means Postgres is live).

Each check green → Phase A complete.

---

## Phase B — Hardening for "real" prod

Not needed for the invited demo but the next sensible steps.

### B1. Rate limiting ⬜

No limits today. Suggest LLM + news RSS + `/api/recommendations` are the expensive paths. Start with per-IP + per-user limits at the reverse proxy or a `slowapi` middleware.

**Touchpoints**: new middleware or reverse-proxy rules.

### B2. Structured logging / observability ⬜

`get_logger` writes to stdout. For prod: JSON logging + a collector (OpenTelemetry, Datadog, Grafana Cloud, etc.). Langfuse already captures LLM traces — complement with infra logs.

**Touchpoints**: [app/core/logging.py](/mnt/data/backend/app/core/logging.py).

### B3. Error surfaces + status page ⬜

Backend returns typed error statuses today (`no_activity` / `no_news` / etc.). Front-end handles most. Consider:
- Global error boundary on the Next app.
- A /health page wired into an uptime monitor.
- Sentry (or equivalent) for unhandled exceptions.

### B4. Frontend CDN / asset hosting ⬜

If serving `next start` directly on a small VPS, static assets are fine. For scale, push `.next/static` to a CDN (Vercel handles this automatically; self-hosted needs a CloudFront / Fastly story).

### B5. Data retention / cleanup ⬜

Ephemeral companion threads (`/events`, `/sheng-yen`, `/whats-new`) tag `deep_dive: true` and accumulate in `thread_metadata`. No UI to delete them. Options:
- Nightly cron: delete ephemeral threads older than N days.
- Expose a cleanup admin endpoint.

Not urgent; volume grows slowly for a limited audience.

### B6. rag_bot events corpus enrichment ⬜

Tracked separately in [docs/rag_bot_events_enrichment.md](/mnt/data/backend/docs/rag_bot_events_enrichment.md). Blocks better event answers (registration URL, contact phone). Upstream rag_bot work.

### B7. Per-tab ThreadList ⬜

Deferred (estimated 5–8h) — see the plan-mode discussion. Enables revisiting prior `/events`, `/sheng-yen`, `/whats-new` threads instead of the current "click active tab to reset" pattern.

---

## Suggested order

1. A1 (HTTPS + hostname) — pick the infra shape.
2. A5 (Postgres) + A7 (Milvus) + A8 (LLM keys) in parallel — all env-shaped, no code changes.
3. A2 (CORS) + A4 (env templates) + A6 (rag_bot packaging) — small code changes.
4. A3 (auth) — biggest variable; decide then implement.
5. A9 — smoke everything.
6. B items once the demo is live and feedback loops are tight enough to prioritise them.

## Notes / decisions

Record decisions, pitfalls, and env values (no secrets) here as they happen.

- _(start filling when Phase A kicks off)_
