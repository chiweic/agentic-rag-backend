# Frontend CI/CD Baseline

## Purpose

This document records the current maintenance baseline for [`frontend-v1`](/home/chiweic/repository/backend/frontend-v1).

The goal is not to describe every future improvement. The goal is to define:

- what currently counts as a passing local gate for `frontend-v1`
- what is safe to commit now
- what remains known maintenance debt

This is the baseline that should be used before broadening CI scope further.

## Current Local Gates

The following commands are the current local quality gates for [`frontend-v1`](/home/chiweic/repository/backend/frontend-v1):

```bash
cd /home/chiweic/repository/backend/frontend-v1
npm run typecheck
npm run lint
npm test
```

### Current Result

As of this maintenance pass:

- `npm run typecheck`: passes
- `npm test`: passes
- `npm run lint`: completes without errors, but still reports warnings

So the current commit-ready interpretation is:

- typecheck must pass
- unit tests must pass
- lint must not introduce errors
- known lint warnings are technical debt, not current blockers

## Verified Local Status

### Type Check

Command:

```bash
npm run typecheck
```

Status:

- passes

Meaning:

- the TypeScript baseline is healthy enough to gate commits

### Unit Tests

Command:

```bash
npm test
```

Status:

- passes
- `49/49` tests passing at the time this document was updated

Meaning:

- the current Vitest unit-test baseline is working and should be part of the gate

### Lint

Command:

```bash
npm run lint
```

Status:

- completes
- currently reports warnings
- no blocking lint errors at the moment

Important note:

- `frontend-v1/biome.json` still declares the older `2.0.0` schema while the installed CLI is newer
- Biome also reports current warnings in:
  - [`frontend-v1/app/MyRuntimeProvider.tsx`](/home/chiweic/repository/backend/frontend-v1/app/MyRuntimeProvider.tsx)
  - [`frontend-v1/components/assistant-ui/attachment.tsx`](/home/chiweic/repository/backend/frontend-v1/components/assistant-ui/attachment.tsx)
  - unit-test files with non-null assertions

These are known cleanup items, but they are not currently being treated as commit blockers.

## What Is In Scope For Commit Right Now

For `frontend-v1`, the safe commit baseline is:

- code that keeps `typecheck` passing
- code that keeps `npm test` passing
- code that does not worsen lint into actual failing errors
- documentation updates that match the current verified gate behavior

This is intentionally narrower than “all browser E2E must pass.”

## E2E Status

Browser E2E is still under active maintenance and redesign.

Relevant document:

- [`docs/e2e_test_plan.md`](/home/chiweic/repository/backend/docs/e2e_test_plan.md)

Current position:

- Playwright remains the web E2E framework
- the suite is being reduced toward a smaller contract-focused `Core`
- the previous E2E set was too coupled to current UI structure
- E2E should not currently be treated as the only frontend commit gate

### Current Practical Rule

For now:

- local gates for commit = typecheck + lint + unit tests
- E2E is important, but still being stabilized and reorganized

That means E2E failures should be triaged seriously, but they should not prevent every frontend maintenance commit while the suite itself is still being redesigned.

## Current Test/Tool Inventory

### Implemented

- TypeScript type checking
- Biome lint/format scripts
- Vitest unit tests
- Playwright browser E2E

### Present in `package.json`

From [`frontend-v1/package.json`](/home/chiweic/repository/backend/frontend-v1/package.json):

- `typecheck`
- `lint`
- `lint:fix`
- `format`
- `format:check`
- `test`
- `test:watch`
- `test:e2e`
- `test:e2e:ui`

## CI Direction

The repository currently has backend CI in:

- [ci.yml](/home/chiweic/repository/backend/.github/workflows/ci.yml)

But `frontend-v1` does not yet have a dedicated frontend workflow file checked in.

The intended next CI step should be a separate frontend workflow that runs:

1. `npm ci`
2. `npm run typecheck`
3. `npm run lint`
4. `npm test`

This frontend workflow should be kept separate from backend CI.

## Recommended Frontend Workflow File

Suggested file:

- `.github/workflows/frontend-ci.yml`

Suggested scope:

- trigger on `frontend-v1/**`
- run in `frontend-v1` working directory
- use Node 22
- cache npm deps via `frontend-v1/package-lock.json`

The first version should only enforce the current passing baseline:

- typecheck
- lint
- unit tests

Do not make browser E2E a required CI gate until the `Core` web E2E suite is intentionally stabilized.

## Known Maintenance Debt

The following items are known but not currently required to block commits:

- Biome schema version mismatch in [`frontend-v1/biome.json`](/home/chiweic/repository/backend/frontend-v1/biome.json)
- Biome warnings in React hook dependencies and accessibility/performance issues
- web E2E scope is still being redesigned around realistic user contracts
- browser-engine differences still exist in Playwright behavior for some streaming scenarios

These are real issues, but they belong to the next cleanup passes, not to the minimum commit-ready baseline.

## Commit Policy For This Maintenance Pass

When committing `frontend-v1` maintenance work now, the expectation is:

- commit only code that passes the current local frontend gates
- do not wait for all historical E2E scenarios to be redesigned first
- keep CI/CD documentation aligned with what is actually enforced today

In short:

- `frontend-v1` commit gate today = `typecheck + lint + unit tests`
- E2E remains active maintenance work, not yet the sole release/commit blocker
