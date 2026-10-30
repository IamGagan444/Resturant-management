import { execSync } from "node:child_process";
import path from "node:path";
import { TEST_DATABASE_URL } from "../vitest.config";

/** Apply migrations to the test database (creates it if missing). Non-destructive; tests truncate data themselves. */
export default function setup() {
  execSync("pnpm exec prisma migrate deploy", {
    cwd: path.resolve(import.meta.dirname, "../../../packages/db"),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
