import { Prisma, PrismaClient } from "@prisma/client";
import { tenantExtension } from "./tenant";

const base = new PrismaClient();

/** Tenant-scoped client. Use this everywhere inside withTenant(). */
export const db = base.$extends(tenantExtension);

/** Raw client with no tenant scoping. Only for platform admin, auth bootstrap and hotel lookup by slug/qrToken. */
export const unscopedDb = base;

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

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

export { withTenant, currentHotelId, TenantContextMissingError, TenantMismatchError } from "./tenant";
export * from "@prisma/client";
