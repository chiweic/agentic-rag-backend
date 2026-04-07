# External Store Integration

This example demonstrates how to use assistant-ui with an external message store using `useExternalStoreRuntime`.

## Quick Start

### Using CLI (Recommended)

```bash
npx assistant-ui@latest create my-app --example with-external-store
cd my-app
```

### Environment Variables

Create `.env.local`:

```
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:8081
NEXT_PUBLIC_OPENAI_COMPAT_BASE_URL=http://localhost:8081/v1
NEXT_PUBLIC_OPENAI_COMPAT_MODEL=agentic-rag
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_JWT_TEMPLATE=
NEXT_PUBLIC_ENABLE_DEV_AUTH=false
```

Auth notes:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` enables the new Clerk production auth path
- `NEXT_PUBLIC_CLERK_JWT_TEMPLATE` is optional but recommended when using Clerk to mint a backend-facing JWT template for FastAPI
- `NEXT_PUBLIC_ENABLE_DEV_AUTH=true` shows the dev-token login option in the UI
- backend must also run with `AUTH_DEV_MODE=True` for `/auth/dev-token` to exist
- when Clerk is configured, `/login` and `/register` use Clerk UI and backend-protected requests use Clerk bearer tokens
- backend must also be configured with Clerk issuer/JWKS settings for Clerk token verification

### Run

```bash
npm run dev
```

### E2E Tests

Playwright specs live in `tests/e2e/`.

```bash
npm run test:e2e
```

If this is the first Playwright run on the machine, install the browser once:

```bash
npx playwright install chromium
```

The current Playwright config runs Chromium in headed mode by default so you can watch the test flow.

## Features

- External store runtime via `useExternalStoreRuntime`
- Zustand-backed thread and auth state
- Local-only signed-out chat via `/v1/chat/completions`
- Backend-linked threads via `/threads*` when signed in
- Clerk-ready register / login / logout path for Phase 5
- Dev-token login path retained only for Playwright / integration testing when Clerk is disabled

## Related Documentation

- [assistant-ui Documentation](https://www.assistant-ui.com/docs)
- [External Store Runtime Guide](https://www.assistant-ui.com/docs/runtimes/external-store)
