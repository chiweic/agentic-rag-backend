# CI/CD Plan: Backend Quality Gate

## Problem

Five milestones of backend work sit as uncommitted changes on top of a single initial commit. There is no CI pipeline, no pre-commit hooks, and no structured commit history. The linter and formatter are configured but not enforced:

- **19 ruff lint errors** (line length, import order, ambiguous variable name, module-level import placement)
- **14 files need reformatting**
- **59 tests pass** (the code works, it just isn't clean)

This plan establishes automated quality gates so the codebase stays clean going forward.

## Step 1: Fix Lint and Format Issues

**What:** Fix all existing violations so the codebase starts from a clean baseline.

Current violations:

| Category | Count | Files |
|----------|-------|-------|
| E501 line too long | 8 | `threads.py`, `thread_store.py`, `chat.py`, `test_openai_compat.py`, `test_thread_auth_phase2.py`, `test_walkthrough.py` |
| E402 module import not at top | 7 | `app/main.py` (intentional — env must load before SDK imports) |
| I001 unsorted imports | 2 | `tests/conftest.py`, `tests/test_thread_auth_phase2.py` |
| E741 ambiguous variable name | 1 | `tests/test_openai_compat.py` |
| Format drift | 14 files | across `app/` and `tests/` |

**E402 in `app/main.py`:** These are intentional — `load_dotenv` and logger init must run before SDK imports (see `CLAUDE.md` and `feedback_env_loading.md`). Add `# noqa: E402` to suppress.

**Action:**
1. Run `ruff format app/ tests/`
2. Run `ruff check --fix app/ tests/` (fixes the 2 auto-fixable import-sort issues)
3. Manually fix remaining line-length and variable-name issues
4. Add `# noqa: E402` to the intentional late imports in `app/main.py`
5. Verify: `ruff check app/ tests/` → 0 errors, `ruff format --check app/ tests/` → 0 reformats, `pytest` → 59 pass

## Step 2: Structured Commits

**What:** Commit the backend changes in logical chunks so git history reflects the milestone progression.

Proposed commit sequence:

| # | Scope | Files |
|---|-------|-------|
| 1 | `fix: lint and format cleanup` | all reformatted files (Step 1 changes only) |
| 2 | `feat: core auth infrastructure` | `app/core/auth.py`, `app/core/config.py` changes, `app/api/auth_dev.py`, `tests/test_auth.py`, `tests/test_auth_dev_mode.py`, `docs/auth_dev.md` |
| 3 | `feat: thread store and ownership` | `app/core/thread_store.py`, `app/api/threads.py` changes, `app/api/normalize.py`, `tests/test_threads.py` changes, `tests/test_thread_auth_phase2.py` |
| 4 | `feat: assisted learning endpoint` | `app/api/assisted_learning.py`, `app/main.py` changes |
| 5 | `feat: agent state and config updates` | `app/agent/state.py`, `pyproject.toml`, `tests/conftest.py`, `tests/test_walkthrough.py` |
| 6 | `docs: planning, api reference, and test plans` | `CLAUDE.md`, `docs/planning.md`, `docs/api_reference.md`, `docs/e2e_test_plan.md`, `docs/frontend_assistant_ui_plan.md` |
| 7 | `chore: gitignore and env example updates` | `.gitignore`, `.env.example` |

Each commit should pass `ruff check`, `ruff format --check`, and `pytest` before proceeding to the next.

**Note:** `frontend-v1/` and `mobile-v1/` are tracked separately — not included in backend commits unless we decide to monorepo them.

## Step 3: GitHub Actions CI

**What:** A CI pipeline that runs on every push and PR to prevent regressions.

File: `.github/workflows/ci.yml`

```yaml
name: Backend CI

on:
  push:
    paths:
      - "app/**"
      - "tests/**"
      - "pyproject.toml"
  pull_request:
    paths:
      - "app/**"
      - "tests/**"
      - "pyproject.toml"

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install ruff
      - run: ruff check app/ tests/
      - run: ruff format --check app/ tests/

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - run: pytest
```

Both jobs must pass to merge. No external services needed — tests use in-memory mocks.

Estimated CI time: ~30s lint + ~20s test = under 1 minute.

## Step 4: Pre-Commit Hooks (Local Gate)

**What:** Catch lint/format issues before they reach the remote.

File: `.pre-commit-config.yaml`

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.8.6
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

Setup: `pip install pre-commit && pre-commit install`

This auto-formats on commit and blocks commits with unfixable lint errors.

## Step 5 (Optional): E2E Gate

**What:** Playwright E2E tests as a separate CI job.

This is more complex because it requires:
- a running backend (`AUTH_DEV_MODE=true`)
- a running frontend dev server
- a Playwright browser

Options:
- **Manual trigger only** (`workflow_dispatch`) — run before releases
- **Nightly schedule** — catch regressions overnight
- **PR gate** — full confidence but slower (~2 min)

Recommend starting with manual trigger, promote to nightly once stable.

## Execution Order

| Phase | Action | Blocks on |
|-------|--------|-----------|
| 1 | Fix lint/format (Step 1) | nothing |
| 2 | Structured commits (Step 2) | Step 1 |
| 3 | Add CI workflow (Step 3) | Step 2 |
| 4 | Add pre-commit hooks (Step 4) | Step 2 |
| 5 | E2E CI (Step 5) | optional, after Step 3 |

Steps 3 and 4 can be done in parallel after commits are in place.

## Success Criteria

- `ruff check app/ tests/` → 0 errors
- `ruff format --check app/ tests/` → 0 reformats
- `pytest` → 59 pass
- Every push triggers CI lint + test
- Pre-commit hooks prevent dirty commits locally
- Git history has meaningful, atomic commits per feature area
