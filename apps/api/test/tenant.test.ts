import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { db, TenantContextMissingError, withTenant } from "@rms/db";
import { closeQueue } from "../src/jobs/queue";
import { Client, createHotel, createPlatformAdmin, getApp, resetDb } from "./helpers";

/** Proves hotel A can never read or write hotel B's data — via the API and directly through the data layer. */
describe("tenant isolation", () => {
  let app: FastifyInstance;
  let a: { hotelId: string; owner: Client };
  let b: { hotelId: string; owner: Client };
  let bCategoryId: string;
  let bItemId: string;
  let bTableId: string;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    const admin = await createPlatformAdmin(app);
    a = await createHotel(app, admin, "hotel-a");
    b = await createHotel(app, admin, "hotel-b");
    const cat = await b.owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "B secret menu" });
    bCategoryId = cat.id;
    bItemId = (await b.owner.ok<{ id: string }>("POST", "/v1/admin/items", { categoryId: cat.id, name: "B Biryani", price: 30000 })).id;
    bTableId = (await b.owner.ok<{ id: string }>("POST", "/v1/admin/tables", { label: "B1" })).id;
    await a.owner.ok("POST", "/v1/admin/categories", { name: "A menu" });
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  it("API: lists only own rows", async () => {
    const cats = await a.owner.ok<{ name: string }[]>("GET", "/v1/admin/categories");
    expect(cats.map((c) => c.name)).toEqual(["A menu"]);
    expect(await a.owner.ok<unknown[]>("GET", "/v1/admin/items")).toEqual([]);
    expect(await a.owner.ok<unknown[]>("GET", "/v1/admin/tables")).toEqual([]);
    const taxes = await a.owner.ok<{ hotelId: string }[]>("GET", "/v1/admin/taxes");
    expect(taxes.every((t) => t.hotelId === a.hotelId)).toBe(true);
  });

  it("API: can't read, update or delete another hotel's rows by id", async () => {
    expect((await a.owner.req("GET", `/v1/admin/items/${bItemId}`)).statusCode).toBe(404);
    expect((await a.owner.req("PATCH", `/v1/admin/items/${bItemId}`, { price: 1 })).statusCode).toBe(404);
    expect((await a.owner.req("DELETE", `/v1/admin/categories/${bCategoryId}`)).statusCode).toBe(404);
    expect((await a.owner.req("POST", `/v1/admin/tables/${bTableId}/rotate-qr`)).statusCode).toBe(404);
    expect((await a.owner.req("POST", `/v1/s/order-items/${bItemId}/transition`, { clientId: "xxxxxxxx-1", to: "COOKING" })).statusCode).toBe(404);
  });

  it("API: can't point own rows at another hotel's ids", async () => {
    const res = await a.owner.req("POST", "/v1/admin/items", { categoryId: bCategoryId, name: "Sneaky", price: 100 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REFERENCE");
    const asg = await a.owner.req("PUT", "/v1/admin/assignments", { date: "2026-10-30", assignments: [{ tableId: bTableId, staffId: "x" }] });
    expect(asg.statusCode).toBe(400);
  });

  it("API: phase 2 bill, swap, floor and layout routes stay inside the hotel", async () => {
    const bTable = await b.owner.ok<{ qrToken: string }[]>("GET", "/v1/admin/tables");
    const guest = new Client(app);
    await guest.ok("POST", "/v1/p/sessions/join", { qrToken: bTable[0]!.qrToken, deviceId: "tenant-guest-01", name: "Bo" });
    await guest.ok("PUT", "/v1/p/cart/items/tenant-cart-0001", { itemId: bItemId, quantity: 1 });
    const order = await guest.ok<{ items: { id: string }[] }>("POST", "/v1/p/orders", { clientId: "tenant-order-0001", payment: "PAY_LATER" });
    const bill = await guest.ok<{ id: string; sessionId: string }>("GET", "/v1/p/bill");

    expect((await a.owner.req("POST", `/v1/s/bills/${bill.id}/split`, { type: "EQUAL", parts: 2 })).statusCode).toBe(404);
    expect((await a.owner.req("POST", `/v1/s/bills/${bill.id}/send`, { phone: "9876543210" })).statusCode).toBe(404);
    expect((await a.owner.req("GET", `/v1/s/sessions/${bill.sessionId}/bill`)).statusCode).toBe(404);
    expect((await a.owner.req("POST", `/v1/s/sessions/${bill.sessionId}/close`)).statusCode).toBe(404);
    expect((await a.owner.req("POST", `/v1/s/order-items/${order.items[0]!.id}/replace`, { clientId: "tenant-swap-0001", itemId: bItemId })).statusCode).toBe(404);
    expect((await a.owner.req("PUT", "/v1/admin/tables/positions", { tables: [{ id: bTableId, posX: 1, posY: 1 }] })).statusCode).toBe(400);
    const floor = await a.owner.ok<{ tables: unknown[] }>("GET", "/v1/s/floor");
    expect(floor.tables).toEqual([]);
    const report = await a.owner.ok<{ orders: { count: number }; open: { sessions: number } }>("GET", "/v1/s/reports/day");
    expect([report.orders.count, report.open.sessions]).toEqual([0, 0]);
  });

  it("data layer: scoped reads/writes never touch another tenant", async () => {
    await withTenant(a.hotelId, async () => {
      expect(await db.menuItem.findUnique({ where: { id: bItemId } })).toBeNull();
      expect(await db.menuItem.findFirst({ where: { name: "B Biryani" } })).toBeNull();
      expect((await db.menuItem.updateMany({ where: { id: bItemId }, data: { price: 1 } })).count).toBe(0);
      expect((await db.menuCategory.deleteMany({})).count).toBe(1); // only A's own category
      await expect(db.menuItem.create({ data: { hotelId: b.hotelId, categoryId: bCategoryId, name: "x", price: 1 } })).rejects.toThrow(
        /does not match/,
      );
    });
    await withTenant(b.hotelId, async () => {
      expect((await db.menuItem.findUniqueOrThrow({ where: { id: bItemId } })).price).toBe(30000);
    });
  });

  it("data layer: no tenant context → hard error", async () => {
    await expect(db.menuItem.findMany()).rejects.toBeInstanceOf(TenantContextMissingError);
  });

  it("staff tokens are bound to their hotel", async () => {
    // Suspending B cuts B's staff off without touching A.
    const admin = new Client(app);
    await admin.ok("POST", "/v1/auth/login", { email: "root@test.dev", password: "rootpass123" });
    await admin.ok("PATCH", `/v1/platform/hotels/${b.hotelId}`, { status: "SUSPENDED" });
    expect((await b.owner.req("GET", "/v1/admin/items")).json().error.code).toBe("HOTEL_SUSPENDED");
    expect((await a.owner.req("GET", "/v1/admin/items")).statusCode).toBe(200);
    // Staff can't use platform routes
    expect((await a.owner.req("GET", "/v1/platform/hotels")).statusCode).toBe(403);
  });
});
