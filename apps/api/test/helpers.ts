import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { unscopedDb } from "@rms/db";
import { buildApp } from "../src/app";
import { hashSecret } from "../src/lib/crypto";

export const cid = () => randomUUID();

export async function resetDb() {
  const tables = await unscopedDb.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await unscopedDb.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

let appPromise: Promise<FastifyInstance> | null = null;
export const getApp = () => (appPromise ??= buildApp());

/** Tiny cookie jar around fastify.inject, so tests exercise the real httpOnly cookie flow. */
export class Client {
  readonly cookies = new Map<string, string>();

  constructor(private readonly app: FastifyInstance) {}

  clone(names: string[]): Client {
    const c = new Client(this.app);
    for (const n of names) {
      const v = this.cookies.get(n);
      if (v) c.cookies.set(n, v);
    }
    return c;
  }

  async req(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
      },
    });
    for (const c of res.cookies) {
      if (c.maxAge === 0 || c.value === "") this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  /** Request that must succeed; returns parsed JSON. */
  async ok<T = Record<string, unknown>>(method: Parameters<Client["req"]>[0], url: string, body?: unknown): Promise<T> {
    const res = await this.req(method, url, body);
    if (res.statusCode >= 300) throw new Error(`${method} ${url} → ${res.statusCode}: ${res.body}`);
    return res.json() as T;
  }
}

export async function createPlatformAdmin(app: FastifyInstance) {
  await unscopedDb.platformUser.create({
    data: { email: "root@test.dev", name: "Root", passwordHash: await hashSecret("rootpass123") },
  });
  const c = new Client(app);
  await c.ok("POST", "/v1/auth/login", { email: "root@test.dev", password: "rootpass123" });
  return c;
}

/** Create a hotel through the platform API and return a signed-in owner client. */
export async function createHotel(app: FastifyInstance, admin: Client, slug: string) {
  const { id } = await admin.ok<{ id: string }>("POST", "/v1/platform/hotels", {
    name: `Hotel ${slug}`,
    slug,
    status: "ACTIVE",
    owner: { name: "Owner", email: `owner@${slug}.test`, password: "ownerpass123", pin: "9999" },
  });
  const owner = new Client(app);
  await owner.ok("POST", "/v1/auth/login", { email: `owner@${slug}.test`, password: "ownerpass123" });
  return { hotelId: id, owner };
}

/** Owner pairs a device of `kind`, then `staffId` signs in on it with PIN. */
export async function staffOnDevice(owner: Client, kind: "KDS" | "WAITER" | "POS", staffId: string, pin: string, stationId?: string) {
  const pairer = owner.clone(["rms_at"]);
  await pairer.ok("POST", "/v1/auth/devices/pair", { name: `${kind} device`, kind, stationId });
  const device = pairer.clone(["rms_dev"]);
  await device.ok("POST", "/v1/auth/pin", { staffId, pin });
  return device;
}
