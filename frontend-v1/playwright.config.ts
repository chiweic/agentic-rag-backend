import { defineConfig, devices } from "@playwright/test";

const port = 3005;
const baseURL = `http://127.0.0.1:${port}`;
const backendBaseURL = "http://127.0.0.1:7081";

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: ["**/archive/**"],
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    headless: true,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_FORCE_DISABLE_CLERK: "true",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      NEXT_PUBLIC_CLERK_JWT_TEMPLATE: "",
      CLERK_SECRET_KEY: "",
      NEXT_PUBLIC_ENABLE_DEV_AUTH: "true",
      NEXT_PUBLIC_BACKEND_BASE_URL: backendBaseURL,
      NEXT_PUBLIC_OPENAI_COMPAT_BASE_URL: `${backendBaseURL}/v1`,
      NEXT_PUBLIC_OPENAI_COMPAT_MODEL: "agentic-rag",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
