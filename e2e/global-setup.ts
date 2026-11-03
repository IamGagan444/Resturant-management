import { execSync } from "node:child_process";
import path from "node:path";
import { E2E_DB } from "./ports";

/**
 * The e2e database: migrate (as owner), enable the app roles, and a fresh demo hotel for every run
 * (the seed deletes and recreates only the demo hotel).
 */
export default function setup() {
  const run = (cmd: string) =>
    execSync(cmd, { cwd: path.resolve(import.meta.dirname, ".."), stdio: "inherit", env: { ...process.env, ...E2E_DB, DATABASE_URL: E2E_DB.DATABASE_ADMIN_URL } });
  run("pnpm db:deploy");
  run("pnpm db:provision");
  run("pnpm db:seed");
}
