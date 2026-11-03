import path from "node:path";
import { config } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { currentHotelId, tenantExtension } from "./tenant";

// Single .env at the repo root (existing process env wins). Loaded here too, so the URLs below are known
// whichever module imports the database first.
config({ path: path.resolve(import.meta.dirname, "../../../.env") });

/**
 * Two connection pools, two database roles (see the RLS migration):
 *  - tenant   DATABASE_URL           role rms_app: PostgreSQL row-level security limits every query to the hotel
 *                                    in `rms.hotel_id`, which this module sets transaction-locally from withTenant().
 *  - platform DATABASE_PLATFORM_URL  role rms_platform: all rows; sign-in, platform admin, jobs, lookups by token.
 * If DATABASE_PLATFORM_URL is unset (local tools only; refused in production by the API) both use DATABASE_URL.
 */
const tenantUrl = process.env.DATABASE_URL;
const platformUrl = process.env.DATABASE_PLATFORM_URL || tenantUrl;

const tenantBase = new PrismaClient(tenantUrl ? { datasourceUrl: tenantUrl } : undefined);
const platformBase = platformUrl && platformUrl !== tenantUrl ? new PrismaClient({ datasourceUrl: platformUrl }) : tenantBase;

/** App-level scoping (adds hotelId to every query) — the first line of defence, also inside transactions. */
const scoped = tenantBase.$extends(tenantExtension);

const setHotel = (client: { $executeRaw: PrismaClient["$executeRaw"] }, hotelId: string) =>
  client.$executeRaw`SELECT set_config('rms.hotel_id', ${hotelId}, TRUE)`;

/**
 * Database-level scoping: each query outside an explicit transaction runs in a tiny transaction that first sets
 * `rms.hotel_id` (transaction-local, so a pooled connection never carries it to the next request).
 */
const rowLevelSecurity = Prisma.defineExtension({
  name: "row-level-security",
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        const hotelId = currentHotelId();
        if (!hotelId) return query(args); // non-tenant work: rms_app sees nothing, by design
        const [, result] = await tenantBase.$transaction([setHotel(tenantBase, hotelId), query(args)]);
        return result;
      },
    },
  },
});

const extended = scoped.$extends(rowLevelSecurity);
type ScopedClient = typeof extended;
type TxClient = Parameters<Parameters<ScopedClient["$transaction"]>[0]>[0];

/**
 * Interactive transactions set `rms.hotel_id` once at the start; their queries then run on that connection
 * (through the app-level scoping, not through a second wrapper). Array-form transactions can't be scoped this
 * way, so they are refused: use `db.$transaction(async (tx) => …)`.
 */
function scopedTransaction<R>(fn: (tx: TxClient) => Promise<R>, options?: { maxWait?: number; timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel }): Promise<R> {
  if (typeof fn !== "function") throw new Error("db.$transaction([...]) is not supported with row-level security; use db.$transaction(async (tx) => ...)");
  const hotelId = currentHotelId();
  return scoped.$transaction(async (tx) => {
    if (hotelId) await setHotel(tx, hotelId);
    return fn(tx as unknown as TxClient);
  }, options);
}

/** Tenant-scoped client. Use this everywhere inside withTenant(). */
export const db: ScopedClient = new Proxy(extended, {
  get(target, prop, receiver) {
    if (prop === "$transaction") return scopedTransaction;
    return Reflect.get(target, prop, receiver);
  },
}) as ScopedClient;

/** Unscoped client (role rms_platform). Only for platform admin, auth bootstrap, jobs and lookups by slug/token. */
export const unscopedDb = platformBase;

export type Db = typeof db;
export type Tx = TxClient;

/**
 * Atomically increment a per-hotel counter and return the new value.
 * Raw SQL so two concurrent checkouts can never get the same order/bill number.
 */
export async function nextCounter(tx: Tx | PrismaClient, hotelId: string, key: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>(Prisma.sql`
    INSERT INTO "Counter" ("hotelId", "key", "value") VALUES (${hotelId}, ${key}, 1)
    ON CONFLICT ("hotelId", "key") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"
  `);
  const row = rows[0];
  if (!row) throw new Error(`Counter ${key} returned no row`);
  return row.value;
}

/**
 * Startup check: the tenant pool must be a role that row-level security applies to (not a superuser, not
 * BYPASSRLS, not the tables' owner), or tenant isolation silently falls back to the application layer alone.
 */
export async function checkDatabaseRoles(): Promise<{ tenantRole: string; platformRole: string; problems: string[] }> {
  const probe = (c: PrismaClient) =>
    c.$queryRaw<{ role: string; superuser: boolean; bypass: boolean; owner: boolean }[]>`
      SELECT r.rolname AS role, r.rolsuper AS superuser, r.rolbypassrls AS bypass,
             EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = 'public' AND t.tablename = 'Order' AND t.tableowner = r.rolname) AS owner
      FROM pg_roles r WHERE r.rolname = current_user`;
  const [[t], [p]] = await Promise.all([probe(tenantBase), probe(platformBase)]);
  const problems: string[] = [];
  if (!t || t.superuser || t.bypass || t.owner) problems.push(`DATABASE_URL connects as "${t?.role}", which bypasses row-level security; use rms_app`);
  if (t?.role !== "rms_app") problems.push(`DATABASE_URL should connect as rms_app (it is "${t?.role}")`);
  if (p?.role === t?.role) problems.push("DATABASE_PLATFORM_URL must be a different role (rms_platform)");
  return { tenantRole: t?.role ?? "?", platformRole: p?.role ?? "?", problems };
}

export async function disconnectDb() {
  await Promise.all([tenantBase.$disconnect(), platformBase.$disconnect()]);
}

export { withTenant, currentHotelId, TenantContextMissingError, TenantMismatchError } from "./tenant";
export * from "@prisma/client";
