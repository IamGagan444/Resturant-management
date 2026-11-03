import { defineConfig, devices } from "@playwright/test";
import { E2E, E2E_DB } from "./ports";

/**
 * Full-stack e2e on its own local database (rms_e2e, see ports.ts) with seeded demo data, as the production DB roles.
 * Runs its own API, customer and console on separate ports (and Next build folders), so it never depends on
 * or disturbs a `pnpm dev` you have running, and payments always use the mock gateway.
 * Prereq: `docker compose up -d`. Global setup migrates, provisions the roles and re-seeds the demo hotel.
 */
const urls = { API_URL: E2E.api, CUSTOMER_URL: E2E.customer, CONSOLE_URL: E2E.console };
// test helpers that read the database (e.g. QR tokens) use the e2e database too
Object.assign(process.env, E2E_DB);

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { trace: "retain-on-failure", actionTimeout: 20_000, navigationTimeout: 60_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @rms/api start",
      url: `${E2E.api}/health`,
      env: { ...urls, ...E2E_DB, PORT: String(E2E.apiPort), PAYMENTS_MOCK: "true", RUN_WORKER: "false" },
      reuseExistingServer: true,
      timeout: 60_000,
      cwd: "..",
    },
    {
      command: `pnpm --filter @rms/customer exec next dev -p ${E2E.customerPort}`,
      url: E2E.customer,
      env: { ...urls, NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: "..",
    },
    {
      command: `pnpm --filter @rms/console exec next dev -p ${E2E.consolePort}`,
      url: E2E.console,
      env: { ...urls, NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: true,
      timeout: 120_000,
      cwd: "..",
    },
  ],
});
