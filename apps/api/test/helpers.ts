import { randomUUID } from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { PrismaClient, unscopedDb } from "@rms/db";
import { buildApp } from "../src/app";
import { hashSecret } from "../src/lib/crypto";
import { redis } from "../src/jobs/queue";
import { currentStep, hotp } from "../src/lib/totp";
import type { DeviceJwk, HubPass, LoginResult } from "@rms/contracts";
import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from "jose";

export const cid = () => randomUUID();

/** Owner connection for test setup only (truncate, RLS inspection). */
let adminClient: PrismaClient | null = null;
export function admin(): PrismaClient {
  adminClient ??= new PrismaClient({ datasourceUrl: process.env.DATABASE_ADMIN_URL });
  return adminClient;
}

/** Authenticators the tests enrolled, by email: the secret and unused recovery codes. */
export const authenticators = new Map<string, { secret: string; recovery: string[] }>();

export async function resetDb() {
  authenticators.clear();
  // test Redis DB only (REDIS_URL .../15 in vitest.config): clears sign-in failure counters between files
  if (!/\/15$/.test(process.env.REDIS_URL ?? "")) throw new Error("Refusing to flush a non-test Redis database");
  await redis.flushdb();
  // the application roles can't TRUNCATE (least privilege): the owner does it
  const tables = await admin().$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await admin().$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

let appPromise: Promise<FastifyInstance> | null = null;
export const getApp = () => (appPromise ??= buildApp());

/** Tiny cookie jar around fastify.inject, so tests exercise the real httpOnly cookie flow. */
export class Client {
  readonly cookies = new Map<string, string>();
  /** Each client is its own phone/browser with its own address, so per-IP route limits behave as in production. */
  readonly ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

  constructor(private readonly app: FastifyInstance) {}

  clone(names: string[]): Client {
    const c = new Client(this.app);
    for (const n of names) {
      const v = this.cookies.get(n);
      if (v) c.cookies.set(n, v);
    }
    return c;
  }

  async req(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method,
      url,
      remoteAddress: this.ip,
      payload: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
        ...headers,
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

/**
 * Password sign-in the way a browser does it: two-step sign-in is required, so the first sign-in enrolls an
 * authenticator (remembered in `authenticators`) and later ones answer the code step with a recovery code
 * (one-time, so repeated sign-ins within one 30 s TOTP window still work).
 */
export async function signIn(c: Client, email: string, password: string): Promise<void> {
  const r = await c.ok<LoginResult>("POST", "/v1/auth/login", { email, password });
  const key = email.toLowerCase();
  if (r.mfaSetupRequired) {
    const { secret } = await c.ok<{ secret: string }>("POST", "/v1/auth/mfa/enroll/start", { mfaToken: r.mfaToken });
    const done = await c.ok<{ recoveryCodes: string[] }>("POST", "/v1/auth/mfa/enroll/finish", { mfaToken: r.mfaToken, code: hotp(secret, currentStep()) });
    authenticators.set(key, { secret, recovery: done.recoveryCodes });
  } else if (r.mfaRequired) {
    const code = authenticators.get(key)?.recovery.shift();
    if (!code) throw new Error(`No authenticator enrolled for ${email}`);
    await c.ok("POST", "/v1/auth/login/mfa", { mfaToken: r.mfaToken, code });
  }
}

export async function createPlatformAdmin(app: FastifyInstance) {
  await unscopedDb.platformUser.create({
    data: { email: "root@test.dev", name: "Root", passwordHash: await hashSecret("rootpass123") },
  });
  const c = new Client(app);
  await signIn(c, "root@test.dev", "rootpass123");
  return c;
}

/** Create a hotel through the platform API and return a signed-in owner client. */
export async function createHotel(app: FastifyInstance, admin: Client, slug: string) {
  const { id } = await admin.ok<{ id: string }>("POST", "/v1/platform/hotels", {
    name: `Hotel ${slug}`,
    slug,
    status: "ACTIVE",
    owner: { name: "Owner", email: `owner@${slug}.test`, password: "ownerpass123", pin: "999999" },
  });
  const owner = new Client(app);
  await signIn(owner, `owner@${slug}.test`, "ownerpass123");
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

/** A device's own ES256 key, as the console keeps it (the hub pass is bound to it). */
export interface DeviceKey {
  privateKey: KeyLike;
  jwk: DeviceJwk;
}

export async function newDeviceKey(): Promise<DeviceKey> {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const { x = "", y = "" } = await exportJWK(publicKey);
  return { privateKey, jwk: { kty: "EC", crv: "P-256", x, y } };
}

/** DPoP-style proof for one hub request, signed by the device key. */
export async function hubProof(key: DeviceKey, method: string, url: string): Promise<string> {
  const u = new URL(url);
  return new SignJWT({ htm: method, htu: `${u.origin}${u.pathname}`, jti: randomUUID() })
    .setProtectedHeader({ typ: "dpop+jwt", alg: "ES256", jwk: key.jwk })
    .setIssuedAt()
    .sign(key.privateKey);
}

/** A signed-in device fetches its hub pass, bound to a fresh device key. */
export async function boundHubPass(device: Client): Promise<{ pass: HubPass; key: DeviceKey }> {
  const key = await newDeviceKey();
  return { pass: await device.ok<HubPass>("POST", "/v1/s/hub/pass", { jwk: key.jwk }), key };
}
