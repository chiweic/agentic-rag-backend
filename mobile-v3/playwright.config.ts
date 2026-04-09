import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // auth flows are sequential
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1, // single worker — shared Logto state
  reporter: "html",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:8081",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
