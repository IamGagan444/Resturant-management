import { Redis, type RedisOptions } from "ioredis";
import { env } from "../env";

let down = false;

/**
 * Logs once when Redis becomes unreachable and once when it recovers, instead of
 * ioredis' "missing 'error' handler" spam on every reconnect attempt.
 */
export function watchRedis<T extends Redis>(client: T, name: string): T {
  client.on("error", (e: Error) => {
    if (down) return;
    down = true;
    console.error(`[redis:${name}] cannot reach ${env.REDIS_URL} (${e.message}). Start it with: docker compose up -d redis`);
  });
  client.on("ready", () => {
    if (!down) return;
    down = false;
    console.info(`[redis:${name}] connected`);
  });
  return client;
}

export function createRedis(name: string, opts: RedisOptions = {}): Redis {
  return watchRedis(new Redis(env.REDIS_URL, opts), name);
}
