import { execSync } from "node:child_process";
import path from "node:path";

/** Fresh demo hotel for every run (seed deletes and recreates only the demo hotel). */
export default function setup() {
  execSync("pnpm db:seed", { cwd: path.resolve(import.meta.dirname, ".."), stdio: "inherit" });
}
