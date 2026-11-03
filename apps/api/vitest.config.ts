import { defineConfig } from "vitest/config";

// Integration tests run against a separate database and Redis DB so dev data is never touched,
// connected as the same least-privilege roles as production, so row-level security is exercised for real.
// The owner (superuser in the local docker Postgres) only migrates, provisions the roles and truncates.
const DB = "localhost:5432/rms_test?schema=public";
export const TEST_ADMIN_DATABASE_URL = `postgresql://rms:rms@${DB}`;
export const TEST_ROLE_PASSWORDS = { app: "rms_app_local_test_only", platform: "rms_platform_local_test_only" };
const TEST_DATABASE_URL = `postgresql://rms_app:${TEST_ROLE_PASSWORDS.app}@${DB}`;
const TEST_PLATFORM_DATABASE_URL = `postgresql://rms_platform:${TEST_ROLE_PASSWORDS.platform}@${DB}`;

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
      DATABASE_PLATFORM_URL: TEST_PLATFORM_DATABASE_URL,
      DATABASE_ADMIN_URL: TEST_ADMIN_DATABASE_URL,
      REDIS_URL: "redis://localhost:6379/15",
      PAYMENTS_MOCK: "true",
      RUN_WORKER: "false",
    },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
