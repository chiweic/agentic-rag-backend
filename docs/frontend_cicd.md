# CI/CD Plan: Frontend Quality Gate

## Problem

`frontend-v1/` has been developed alongside 5 backend milestones with no CI pipeline, no lint enforcement, and no unit tests. The codebase has:

- **9 Playwright e2e specs** — comprehensive but require live backend (local LLM + Postgres)
- **0 unit tests** — no Vitest/Jest setup; store logic and API client are untested in isolation
- **No linter** — no ESLint or Biome configured
- **TypeScript strict mode** — `tsc --noEmit` passes clean (0 errors)
- **No pre-commit hooks** — nothing prevents broken code from being committed
- **No CI workflow** — no automated checks on push/PR

The e2e tests cover the happy path well, but the core state management logic (`chat-store.ts`, `auth-store.ts`) has complex edge cases (thread reconciliation, optimistic rollback, sync status state machine) that are better pinned with fast unit tests.

## Current Inventory

| Category | Status |
|----------|--------|
| TypeScript strict mode | Enabled, 0 errors |
| Lint (ESLint/Biome) | Not configured |
| Unit tests | None |
| E2E tests (Playwright) | 9 spec files, require live infra |
| Pre-commit hooks | None |
| CI pipeline | None |

### Testable Modules (`lib/`)

| Module | Complexity | What to unit-test |
|--------|-----------|-------------------|
| `chat-store.ts` | High | `createThread`, `linkThreadToBackend`, `reconcileBackendThreads`, `renameThread`, `deleteThread`, sync status transitions, optimistic rollback, `resetForAuthBoundary` |
| `auth-store.ts` | Medium | `signInWithToken`, `signOut`, JWT decode, provider detection, `invalidateAuthSession`, `resetForAuthBoundary` |
| `backend-threads.ts` | Medium | Request formatting, SSE event parsing, 401 → `BackendAuthError`, auth header injection |
| `auth-client.ts` | Low | `createDevToken` request shape |
| `assisted-learning.ts` | Low | Auth header injection, 401 handling |
| `clerk.ts` | Low | `isClerkEnabled` flag logic |
| `utils.ts` | Trivial | `cn()` class merging |

## Step 1: TypeScript Type Check (CI gate)

**What:** Add `tsc --noEmit` as a CI job. Already passes — zero effort to enforce.

**Action:**
1. Add `"typecheck": "tsc --noEmit"` to `package.json` scripts
2. Add CI workflow job (see Step 4)

**Why first:** Cheapest gate, catches broken imports, missing types, bad refactors. Runs in ~5s.

## Step 2: Linter Setup (Biome)

**What:** Add a fast linter/formatter. Biome is recommended over ESLint for this project because:
- Single tool for both lint and format (like ruff for Python)
- Fast (written in Rust, sub-second on this codebase)
- Zero plugins needed — built-in TypeScript + React support
- No dependency on ESLint plugin ecosystem

**Action:**
1. Install: `npm install --save-dev @biomejs/biome`
2. Create `biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2
  },
  "files": {
    "ignore": [".next/", "node_modules/", "test-results/"]
  }
}
```
3. Add scripts to `package.json`:
```json
"lint": "biome check .",
"lint:fix": "biome check --fix .",
"format": "biome format --write .",
"format:check": "biome format ."
```
4. Fix any initial violations
5. Verify: `npx biome check .` → 0 errors

**Current violation count:** TBD — run after install to assess.

## Step 3: Unit Tests with Vitest

**What:** Add Vitest for testing store logic and API clients in isolation — no browser, no backend needed.

**Action:**
1. Install:
```bash
npm install --save-dev vitest @testing-library/jest-dom
```
2. Add `vitest.config.ts`:
```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```
3. Add script: `"test": "vitest run"`, `"test:watch": "vitest"`
4. Write unit tests (priority order):

### Priority 1: `chat-store.ts` (highest complexity)
```
tests/unit/chat-store.test.ts
- createThread creates local thread with correct defaults
- linkThreadToBackend sets backendThreadId and status "linked"
- reconcileBackendThreads merges without duplicating existing linked threads
- reconcileBackendThreads adds new backend-only threads
- renameThread updates title locally
- deleteThread removes from threads map and reorders
- deleteThread with error restores thread at original index
- resetForAuthBoundary clears linked threads, keeps default
- sync status transitions: local → syncing → linked, local → syncing → error
```

### Priority 2: `auth-store.ts`
```
tests/unit/auth-store.test.ts
- signInWithToken decodes JWT and sets profile
- signInWithToken detects provider from issuer (dev, clerk, google)
- signOut clears token and profile
- invalidateAuthSession triggers sign-out
- resetForAuthBoundary clears linked threads via chat-store
```

### Priority 3: `backend-threads.ts`
```
tests/unit/backend-threads.test.ts
- createBackendThread sends POST /threads with auth header
- listBackendThreads sends GET /threads with auth header
- 401 response throws BackendAuthError
- streamBackendThreadRun parses SSE events correctly
- requests omit Authorization header when no token available
```

**Estimated test count:** ~25-30 unit tests.
**Run time:** <2s (no browser, no network).

## Step 4: GitHub Actions CI

**What:** CI pipeline on push/PR to `frontend-v1/` paths.

File: `.github/workflows/frontend-ci.yml`

```yaml
name: Frontend CI

on:
  push:
    paths:
      - "frontend-v1/**"
  pull_request:
    paths:
      - "frontend-v1/**"

defaults:
  run:
    working-directory: frontend-v1

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend-v1/package-lock.json
      - run: npm ci
      - run: npm run typecheck

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend-v1/package-lock.json
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend-v1/package-lock.json
      - run: npm ci
      - run: npm test
```

**Note:** E2E tests (`test:e2e`) are excluded from CI — they require a running backend with local LLM access. Run locally before releases.

## Step 5: Pre-Commit Hooks

**What:** Run type check + lint on staged frontend files before commit.

Two options:

### Option A: Biome-only (recommended — fast, no extra deps)
Add to the existing root `.pre-commit-config.yaml`:
```yaml
  - repo: https://github.com/biomejs/pre-commit
    rev: "v2.0.0"
    hooks:
      - id: biome-check
        additional_dependencies: ["@biomejs/biome@2.0.0"]
        args: ["--files-ignore-unknown=true"]
```

### Option B: lint-staged via Husky (alternative)
```bash
npm install --save-dev husky lint-staged
npx husky init
```

`.lintstagedrc`:
```json
{
  "*.{ts,tsx}": ["biome check --fix", "biome format --write"]
}
```

Option A integrates with the backend's existing pre-commit setup. Option B is self-contained within `frontend-v1/`.

## Step 6 (Optional): E2E in CI

**What:** Playwright e2e as a manual-trigger or nightly job.

Same constraint as backend — requires live LLM endpoint. Options:
- **`workflow_dispatch`** — manual trigger before releases
- **Nightly schedule** — catch regressions overnight
- Requires backend running with `AUTH_DEV_MODE=true` + Postgres + LLM

Recommend deferring until a CI-accessible LLM mock or test double is available.

## Execution Order

| Phase | Action | Blocks on | Can run in CI |
|-------|--------|-----------|---------------|
| 1 | Type check gate (Step 1) | nothing | Yes |
| 2 | Biome lint/format (Step 2) | nothing | Yes |
| 3 | Vitest unit tests (Step 3) | nothing | Yes |
| 4 | GitHub Actions CI (Step 4) | Steps 1-3 | — |
| 5 | Pre-commit hooks (Step 5) | Step 2 | — |
| 6 | E2E in CI (Step 6) | optional | No (needs LLM) |

Steps 1, 2, and 3 can be done in parallel — no dependencies between them.

## Success Criteria

- `tsc --noEmit` → 0 errors
- `biome check .` → 0 errors
- `vitest run` → ~25+ tests pass
- Every push to `frontend-v1/` triggers CI (typecheck + lint + unit test)
- Pre-commit hooks prevent broken commits locally
- E2E tests remain runnable locally: `npx playwright test`
