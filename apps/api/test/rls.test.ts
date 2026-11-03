import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { PrismaClient, db, withTenant } from "@rms/db";
import { closeQueue } from "../src/jobs/queue";
import { admin, createHotel, createPlatformAdmin, getApp, resetDb } from "./helpers";

/**
 * PostgreSQL row-level security, tested below the application: raw SQL as the API's own database roles,
 * with the app-level Prisma scoping out of the picture.
 */
describe("row-level security", () => {
  let app: FastifyInstance;
  let a: string;
  let b: string;
  const asApp = () => new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  let raw: PrismaClient;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    const root = await createPlatformAdmin(app);
    const ha = await createHotel(app, root, "rls-a");
    const hb = await createHotel(app, root, "rls-b");
    a = ha.hotelId;
    b = hb.hotelId;
    await ha.owner.ok("POST", "/v1/admin/floors", { name: "A only" });
    await hb.owner.ok("POST", "/v1/admin/floors", { name: "B only" });
    raw = asApp();
  });

  afterAll(async () => {
    await raw.$disconnect();
    await app.close();
    await closeQueue();
  });

  /** Run SQL as rms_app inside one transaction, optionally with the hotel setting the Prisma client would make. */
  async function asTenant<T>(hotelId: string | null, fn: (tx: Omit<PrismaClient, "$transaction" | "$connect" | "$disconnect" | "$on" | "$extends">) => Promise<T>) {
    return raw.$transaction(async (tx) => {
      if (hotelId) await tx.$executeRaw`SELECT set_config('rms.hotel_id', ${hotelId}, TRUE)`;
      return fn(tx);
    });
  }

  it("the API connects as non-owner roles without RLS bypass", async () => {
    const [who] = await raw.$queryRaw<{ user: string; bypass: boolean; superuser: boolean }[]>`
      SELECT current_user AS user, rolbypassrls AS bypass, rolsuper AS superuser FROM pg_roles WHERE rolname = current_user`;
    expect(who).toEqual({ user: "rms_app", bypass: false, superuser: false });
  });

  it("every table with a hotelId has RLS on and a tenant policy for rms_app", async () => {
    const rows = await admin().$queryRaw<{ table: string; rls: boolean; policies: string[] }[]>`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
             COALESCE(array_agg(p.polname) FILTER (WHERE p.polname IS NOT NULL), '{}') AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
      WHERE c.relkind = 'r' AND c.relname <> '_prisma_migrations'
      GROUP BY c.relname, c.relrowsecurity`;
    const withHotel = await admin().$queryRaw<{ table: string }[]>`
      SELECT table_name AS table FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'hotelId'`;
    const byName = new Map(rows.map((r) => [r.table, r]));
    expect(rows.every((r) => r.rls)).toBe(true); // every table, tenant or not
    for (const { table } of withHotel) {
      if (table === "WebhookEvent") continue; // platform table (nullable hotelId), no rms_app grant
      expect(byName.get(table)?.policies, table).toContain("tenant_isolation");
    }
  });

  it("without the hotel setting, rms_app sees no rows at all", async () => {
    const [n] = await asTenant(null, (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Floor"`);
    expect(Number(n?.n)).toBe(0);
    const [h] = await asTenant(null, (tx) => tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "Hotel"`);
    expect(Number(h?.n)).toBe(0);
  });

  it("with hotel A set, a query with no WHERE still returns only A's rows", async () => {
    const floors = await asTenant(a, (tx) => tx.$queryRaw<{ name: string; hotelId: string }[]>`SELECT name, "hotelId" FROM "Floor"`);
    expect(floors.length).toBeGreaterThan(0);
    expect(floors.every((f) => f.hotelId === a)).toBe(true);
    expect(floors.map((f) => f.name)).not.toContain("B only");
    const hotels = await asTenant(a, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Hotel"`);
    expect(hotels).toEqual([{ id: a }]);
  });

  it("rms_app can't write rows for another hotel, or move a row to one", async () => {
    await expect(asTenant(a, (tx) => tx.$executeRaw`INSERT INTO "Floor" ("id", "hotelId", "name") VALUES ('rls-x', ${b}, 'sneaky')`)).rejects.toThrow(/row-level security/);
    const moved = await asTenant(a, (tx) => tx.$executeRaw`UPDATE "Floor" SET "hotelId" = ${b} WHERE "hotelId" = ${a}`).catch((e: Error) => e);
    expect(moved).toBeInstanceOf(Error);
    // B's rows are invisible to updates and deletes too
    expect(await asTenant(a, (tx) => tx.$executeRaw`DELETE FROM "Floor" WHERE "hotelId" = ${b}`)).toBe(0);
  });

  it("rms_app has no access to platform tables and no DDL / TRUNCATE / role escape", async () => {
    for (const sql of [
      `SELECT * FROM "PlatformUser"`,
      `SELECT * FROM "RefreshToken"`,
      `SELECT * FROM "WebhookEvent"`,
      `TRUNCATE "Floor"`,
      `ALTER TABLE "Floor" DISABLE ROW LEVEL SECURITY`,
      `SET ROLE rms_platform`,
      `DELETE FROM "Hotel"`,
    ]) {
      await expect(asTenant(a, (tx) => tx.$executeRawUnsafe(sql)), sql).rejects.toThrow();
    }
  });

  it("the Prisma tenant client sets the hotel on its own (queries and interactive transactions)", async () => {
    const floors = await withTenant(a, async () => await db.floor.findMany());
    expect(floors.every((f) => f.hotelId === a)).toBe(true);
    const inTx = await withTenant(b, async () => await db.$transaction(async (tx) => tx.$queryRaw<{ hotelId: string }[]>`SELECT "hotelId" FROM "Floor"`));
    expect(inTx.length).toBeGreaterThan(0);
    expect(inTx.every((f) => f.hotelId === b)).toBe(true);
    // raw SQL outside a tenant transaction has no hotel set: nothing, rather than everything
    expect(await db.$queryRaw<unknown[]>`SELECT * FROM "Floor"`).toEqual([]);
    expect(() => db.$transaction([] as never)).toThrow(/not supported/);
  });

  it("the setting is transaction-local: a pooled connection never carries a hotel into the next query", async () => {
    await asTenant(a, (tx) => tx.$queryRaw`SELECT 1`);
    const [after] = await raw.$queryRaw<{ v: string | null }[]>`SELECT current_setting('rms.hotel_id', true) AS v`;
    expect(after?.v ?? "").toBe("");
  });
});
