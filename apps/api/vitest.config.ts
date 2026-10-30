import { defineConfig } from "vitest/config";

// Integration tests run against a separate database and Redis DB so dev data is never touched.
export const TEST_DATABASE_URL = "postgresql://rms:rms@localhost:5432/rms_test?schema=public";

export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DATABASE_URL,
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
