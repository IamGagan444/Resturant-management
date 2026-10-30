import { mkdir } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { buildApp } from "./app";
import { initRealtime, closeRealtime } from "./realtime/io";
import { startWorker } from "./jobs/worker";
import { closeQueue } from "./jobs/queue";

if (env.STORAGE_DRIVER === "local") await mkdir(path.resolve(env.UPLOAD_DIR), { recursive: true });

const app = await buildApp();
initRealtime(app.server);
const stopWorker = env.RUN_WORKER ? await startWorker() : null;

await app.listen({ port: env.PORT, host: "0.0.0.0" });

async function shutdown(signal: string) {
  app.log.info(`${signal}: shutting down`);
  await app.close();
  await closeRealtime();
  await stopWorker?.();
  await closeQueue();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
