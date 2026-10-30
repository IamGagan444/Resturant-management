import { readFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";
import { createHub } from "./app";

// The hub box has its own .env (apps/hub/.env); the repo root .env is a fallback for local development.
config({ path: path.resolve(import.meta.dirname, "../.env") });
config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const Env = z.object({
  CLOUD_URL: z.string().url(),
  HUB_TOKEN: z.string().min(20, "HUB_TOKEN missing: pair the hub in Manage → Devices"),
  HUB_PORT: z.coerce.number().int().default(4100),
  HUB_DATA_FILE: z.string().default("./hub-data/state.json"),
  /** console origins allowed to call the hub, comma separated */
  HUB_ALLOWED_ORIGINS: z.string().default("http://localhost:3001"),
  HUB_POLL_MS: z.coerce.number().int().min(1000).default(5000),
  /** TLS: needed in production because the console is served over HTTPS (browsers block http:// calls from https pages) */
  HUB_TLS_CERT: z.string().optional(),
  HUB_TLS_KEY: z.string().optional(),
});

const env = Env.parse(process.env);
const hub = await createHub({
  cloudUrl: env.CLOUD_URL.replace(/\/$/, ""),
  token: env.HUB_TOKEN,
  dataFile: path.resolve(env.HUB_DATA_FILE),
  origins: env.HUB_ALLOWED_ORIGINS.split(",").map((s) => s.trim()),
  pollMs: env.HUB_POLL_MS,
  https: env.HUB_TLS_CERT && env.HUB_TLS_KEY ? { cert: readFileSync(env.HUB_TLS_CERT), key: readFileSync(env.HUB_TLS_KEY) } : undefined,
  log: true,
});
await hub.start(env.HUB_PORT);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void hub.close().finally(() => process.exit(0));
  });
}
