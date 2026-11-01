import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * Screenshots of every screen at phone and desktop size, for design review (not a test).
 * `pnpm --filter @rms/e2e exec playwright test -c shots.config.ts`; images go to SHOTS_DIR (default ./shots-out).
 */
export default defineConfig({ ...base, testDir: "./shots", reporter: "list", timeout: 600_000 });
