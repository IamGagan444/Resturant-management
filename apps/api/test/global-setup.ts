import { execSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@rms/db";
import { provisionRoles } from "@rms/db/provision";
import { TEST_ADMIN_DATABASE_URL, TEST_ROLE_PASSWORDS } from "../vitest.config";

/**
 * Apply migrations to the test database as its owner (creates it if missing), then give the application roles
 * their test passwords. Non-destructive; tests truncate data themselves.
 */
export default async function setup() {
  execSync("pnpm exec prisma migrate deploy", {
    cwd: path.resolve(import.meta.dirname, "../../../packages/db"),
    env: { ...process.env, DATABASE_URL: TEST_ADMIN_DATABASE_URL, DATABASE_ADMIN_URL: TEST_ADMIN_DATABASE_URL },
    stdio: "pipe",
  });
  const admin = new PrismaClient({ datasourceUrl: TEST_ADMIN_DATABASE_URL });
  try {
    await provisionRoles(admin, TEST_ROLE_PASSWORDS);
  } finally {
    await admin.$disconnect();
  }
}
