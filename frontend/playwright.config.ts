import { defineConfig, devices } from "@playwright/test";

// E2E config: assumes the FastAPI backend is running on 127.0.0.1:8000
// against a clean test schema (reuse tests/conftest.py's per-session DB
// pattern; the orchestration script in CI handles spin-up/teardown).
// The dev server (vite preview) serves the built frontend on 5173.
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173";
const API_BASE = process.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: { "X-Playwright-Test": "1" },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npm run preview -- --port 5173 --strictPort",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: { VITE_API_BASE: API_BASE },
      },
});