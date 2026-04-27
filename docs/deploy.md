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

### A0. Infra baseline ✅

Five compose stacks run on the server and survive reboots (all `restart: unless-stopped`). Everything else on the host (open-webui, supabase, crawler, embedding, reranker, alchemist, /mnt/data/ duplicate clones, etc.) is **not** part of this project.

| # | Stack | Compose file | Containers | Role | Host ports |
|---|---|---|---|---|---|
| 1 | `milvus` | `/home/chiweic/repo/milvus/docker-compose.yml` | etcd, minio, standalone | Vector DB for `rag_bot` retrieval | `19530` |
| 2 | `tei` | `/home/chiweic/repo/TEI/docker-compose.yml` | tei-embedder (`bge-m3`), tei-reranker (`bge-reranker-large`) | Embeddings + rerank for retrieval | `8080`, `8081` |
| 3 | `langfuse` | `/home/chiweic/repo/langfuse/docker-compose.yml` + local `docker-compose.override.yml` | web, worker, postgres, redis, clickhouse, minio | LLM tracing / observability | `3000` (web), `9090` (s3); rest on 127.0.0.1 |
| 4 | `backend` (postgres only) | [docker-compose.yml](/mnt/data/backend/docker-compose.yml) | langgraph-postgres | Thread checkpointer + `thread_metadata` | `127.0.0.1:5434` |
| 5 | `frontend` | [frontend/docker-compose.yml](/mnt/data/backend/frontend/docker-compose.yml) | backend-v2-frontend (Next.js standalone) | Chat UI + API proxy | `3100` |

**Host-run (not yet dockerized)**
- Backend FastAPI / uvicorn on `0.0.0.0:8082` — tracked as A6 below.
- `rag_bot` Python package — `pip install -e /mnt/data/rag_bot`, imported by the backend.

**Hosted elsewhere** (referenced by this project but not on this server)
- **Logto OSS** (auth) — runs on the Raspberry Pi 4, reached at `auth.changpt.org` / `logto-admin.changpt.org` (see A1).
- **Cloudflare Tunnel** (public ingress) — also on the Pi.

**Boot order after a cold reboot** (each directory, or let restart policies handle it):
1. `cd ~/repo/milvus && docker compose up -d`
2. `cd ~/repo/TEI && docker compose up -d`
3. `cd ~/repo/langfuse && docker compose up -d`
4. `cd /mnt/data/backend && docker compose up -d` (langgraph-postgres)
5. `cd /mnt/data/backend/frontend && docker compose up -d`
6. Backend uvicorn — still host-run (`uvicorn app.main:app --host 0.0.0.0 --port 8082`); dockerization tracked in A6.

**Cleanup done 2026-04-24**:
- Added `restart: unless-stopped` to all three milvus services + langgraph-postgres; added `pg_isready` healthcheck to langgraph-postgres; tightened its bind to `127.0.0.1:5434`.
- Pruned 6 orphan volumes (4 anonymous + `backend_logto-pgdata` + `open-webui_open-webui`).
- Created shared bridge network `changpt_net` and attached every running container. Each compose file now declares `changpt_net` as `external: true`; Langfuse uses a local `docker-compose.override.yml` (upstream compose stays pristine). Cross-stack DNS works by container name: `milvus-standalone`, `langgraph-postgres`, `langfuse-postgres-1`, `tei-embedder`, etc. Backend container (A6) can drop `host.docker.internal` once attached.

**Open follow-ups**:
- Langfuse minio still binds `0.0.0.0:9090`; harmless on LAN but wider than needed.
- After the backend moves into a container on `changpt_net`, the frontend's `LANGGRAPH_API_URL` switches from `http://host.docker.internal:8082` to `http://backend:8082` and `extra_hosts` can be removed.

### A1. HTTPS + public hostname 🟡

**Architecture chosen:** Cloudflare Tunnel on a Raspberry Pi 4 acts as the single public ingress. The Pi already tunnels Logto at `auth.changpt.org` / `logto-admin.changpt.org`. A new ingress rule points `app.changpt.org` → server's LAN IP:3000 where the Next.js frontend runs in Docker.

```
Internet
  ├── https://auth.changpt.org
  ├── https://logto-admin.changpt.org    → Pi 4 (cloudflared)
  └── https://app.changpt.org             →      → server LAN IP:3000 (docker)
                                                      └── proxies /api/* → host.docker.internal:8082 (uvicorn backend on host)
```

Why this shape:
- Pi 4 isn't burdened with Next.js SSR — it just routes.
- Backend (uvicorn + Milvus-heavy queries) stays on the server, reached only via the Next.js proxy at [frontend/app/api/[..._path]/route.ts](/mnt/data/backend/frontend/app/api/%5B..._path%5D/route.ts). No public port for the backend; no CORS to pin because browsers always hit one origin.
- One Cloudflare tunnel; no extra certs.

**Pi cloudflared ingress** (`/etc/cloudflared/config.yml` or Zero Trust dashboard):
```yaml
ingress:
  - hostname: auth.changpt.org
    service: http://logto-core:3001          # docker-compose service on Pi
  - hostname: logto-admin.changpt.org
    service: http://logto-console:3002
  - hostname: app.changpt.org
    service: http://<SERVER_LAN_IP>:3100     # frontend container on server (3000 is Langfuse)
  - service: http_status:404
```

Pi-local container names only resolve because cloudflared shares their docker network. Cross-host traffic must use the LAN IP + a published port.

**DNS** (Cloudflare zone `changpt.org`): CNAME `app.changpt.org` → `<tunnel-uuid>.cfargotunnel.com`. Same as the existing auth/admin entries.

**Frontend container on the server**: ships as Docker now — `next build` + `next start` from the standalone output (much faster than `npm run dev`). See [frontend/Dockerfile](/mnt/data/backend/frontend/Dockerfile) and [frontend/docker-compose.yml](/mnt/data/backend/frontend/docker-compose.yml). `next.config.ts` sets `output: "standalone"` so the runner image stays at ~150MB.

**Run on the server** once `frontend/.env.local` has production values (see A3a + A4):
```bash
cd frontend
docker compose build
docker compose up -d
```

Confirm from the Pi:
```bash
pi$ curl -I http://<SERVER_LAN_IP>:3100   # expect 200 / redirect
```

Then hit `https://app.changpt.org` in a browser.

**Status**:
- ✅ `app.changpt.org` cloudflared ingress added on the Pi.
- ✅ `output: "standalone"` + Dockerfile + compose file committed.
- ⬜ DNS CNAME verified.
- ⬜ First `docker compose up -d` on the server succeeds.
- ⬜ Cross-LAN curl from Pi returns non-zero.

**Touchpoints** (now): [frontend/next.config.ts](/mnt/data/backend/frontend/next.config.ts), [frontend/Dockerfile](/mnt/data/backend/frontend/Dockerfile), [frontend/.dockerignore](/mnt/data/backend/frontend/.dockerignore), [frontend/docker-compose.yml](/mnt/data/backend/frontend/docker-compose.yml).

**Trade-off noted**: Pi is a single point of failure — if the tunnel drops, both auth and app go down. Acceptable for the invited demo. Second cloudflared connector on the server is a Phase B upgrade.

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
   - **Redirect URIs** → `<frontend-base-url>/api/logto/sign-in-callback` (e.g. `https://app.changpt.org/api/logto/sign-in-callback`). Note the path is `/api/logto/sign-in-callback`, NOT `/api/auth/callback` — the actual callback route is at [frontend/app/api/logto/sign-in-callback/route.ts](/mnt/data/backend/frontend/app/api/logto/sign-in-callback/route.ts).
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

### B8. Global 401 handler — auto-recover stale auth state ⬜

The Next.js middleware checks "do you have a Logto session cookie?" and lets the page render. If the cached access token has since expired, was issued under rotated keys, or was minted for a different audience, the actual API calls surface a confusing runtime error (`Failed to create thread: 401`, `Thread is not yet initialized`) instead of redirecting to sign-in.

Real-world triggers:
- User idle for >1 h (token TTL expires; refresh usually papers over it but not always).
- User away for days/weeks → refresh token also expired.
- We rotate Logto signing keys, change the API resource audience, or backend deploys a breaking auth change → every signed-in user 401s on next load.
- Logto restart / DB hiccup.

Fix shape: a `handle401(res)` helper imported by [threadListAdapter.ts](/mnt/data/backend/frontend/lib/threadListAdapter.ts), [chatApi.ts](/mnt/data/backend/frontend/lib/chatApi.ts), [feedbackAdapter.ts](/mnt/data/backend/frontend/lib/feedbackAdapter.ts), [recommendations.ts](/mnt/data/backend/frontend/lib/recommendations.ts), [whatsNew.ts](/mnt/data/backend/frontend/lib/whatsNew.ts), [quiz.ts](/mnt/data/backend/frontend/lib/quiz.ts), [sources.ts](/mnt/data/backend/frontend/lib/sources.ts). On any 401, clear local auth state and redirect to `/api/logto/sign-in?redirectUri=<current_path>`. If the Logto session is still alive, silent SSO sends the user through invisibly; otherwise they see the sign-in page once.

Estimated ~30 lines + a one-shot QA pass. Low-risk, contained.

**Touchpoints**: 7 lib files, no backend changes.

---

## Suggested order

0. A0 (infra baseline) — ✅ done 2026-04-24.
1. A1 (HTTPS + hostname) — pick the infra shape.
2. A5 (Postgres) + A7 (Milvus) + A8 (LLM keys) in parallel — all env-shaped, no code changes.
3. A2 (CORS) + A4 (env templates) + A6 (rag_bot packaging) — small code changes.
4. A3 (auth) — biggest variable; decide then implement.
5. A9 — smoke everything.
6. B items once the demo is live and feedback loops are tight enough to prioritise them.

## Notes / decisions

Record decisions, pitfalls, and env values (no secrets) here as they happen.

- _(start filling when Phase A kicks off)_
