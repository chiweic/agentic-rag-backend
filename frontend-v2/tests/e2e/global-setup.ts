/**
 * E2E global setup — verify the backend is running with AUTH_DEV_MODE=true.
 *
 * Since we no longer use @clerk/testing, auth in E2E tests works by:
 * 1. Minting a dev JWT via POST /auth/dev-token (backend dev signer)
 * 2. Intercepting the frontend's /api/auth/token call via page.route()
 * 3. Setting a fake session cookie so middleware doesn't redirect
 */
export default async function globalSetup() {
  const backendUrl = process.env["E2E_BACKEND_URL"] ?? "http://localhost:7081";

  const res = await fetch(`${backendUrl}/health`).catch(() => null);
  if (!res?.ok) {
    throw new Error(
      `Backend not reachable at ${backendUrl}. Start it with AUTH_DEV_MODE=true.`,
    );
  }
}
