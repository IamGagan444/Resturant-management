/** Ports for the e2e stack, separate from `pnpm dev` (4000 / 3000 / 3001). */
const apiPort = 4010;
const customerPort = 3010;
const consolePort = 3011;

export const E2E = {
  apiPort,
  customerPort,
  consolePort,
  api: `http://localhost:${apiPort}`,
  customer: `http://localhost:${customerPort}`,
  console: `http://localhost:${consolePort}`,
} as const;

/**
 * The e2e stack's own database on the local docker Postgres (`docker compose up -d`), connected as the same
 * least-privilege roles as production — never the shared dev database. Test-only passwords (same as the API tests;
 * roles are cluster-wide).
 */
const DB = "localhost:5432/rms_e2e?schema=public";
export const E2E_DB = {
  DATABASE_ADMIN_URL: `postgresql://rms:rms@${DB}`,
  DATABASE_URL: `postgresql://rms_app:rms_app_local_test_only@${DB}`,
  DATABASE_PLATFORM_URL: `postgresql://rms_platform:rms_platform_local_test_only@${DB}`,
  RMS_APP_DB_PASSWORD: "rms_app_local_test_only",
  RMS_PLATFORM_DB_PASSWORD: "rms_platform_local_test_only",
} as const;
