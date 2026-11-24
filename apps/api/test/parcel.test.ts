import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { BillView, OrderView, SessionView, WaiterBoard } from "@rms/contracts";
import { unscopedDb } from "@rms/db";
import { closeQueue } from "../src/jobs/queue";
import { Client, cid, createHotel, createPlatformAdmin, getApp, resetDb } from "./helpers";

interface T {
  id: string;
  qrToken: string;
  code: string;
}

describe("table codes and parcel", () => {
  let app: FastifyInstance;
  let admin: Client;
  let owner: Client;
  let hotelId: string;
  let table: T;
  let naan: string;

  beforeAll(async () => {
    app = await getApp();
    await resetDb();
    admin = await createPlatformAdmin(app);
    ({ owner, hotelId } = await createHotel(app, admin, "parcel-hotel"));
    table = await owner.ok<T>("POST", "/v1/admin/tables", { label: "P1" });
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Breads" });
    naan = (await owner.ok<{ id: string }>("POST", "/v1/admin/items", { categoryId: cat.id, name: "Naan", price: 5000, foodType: "VEG" })).id;
    await owner.ok("PATCH", "/v1/admin/hotel", { requireWaiterConfirm: false, allowPayLater: true });
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  const type = (code: unknown, c = new Client(app)) => c.req("POST", "/v1/p/table-code", { code });

  it("a typed code opens the same table as the QR, however it's typed", async () => {
    expect(table.code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
    for (const typed of [table.code, table.code.toLowerCase(), ` ${table.code.slice(0, 3)}-${table.code.slice(3)} `]) {
      const r = await type(typed);
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ slug: "parcel-hotel", qrToken: table.qrToken });
    }
  });

  it("refuses bad and unknown codes", async () => {
    for (const bad of ["", "ABC", "ABCDEFG", "ABC10O", "P1", "' OR 1=1", "x".repeat(41), 123456, null, undefined]) expect((await type(bad)).statusCode).toBe(400);
    const unknown = table.code === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ";
    const r = await type(unknown);
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("TABLE_CODE_NOT_FOUND");
  });

  it("limits guessing per IP, also for a signed-in guest", async () => {
    const c = new Client(app);
    const codes: number[] = [];
    for (let i = 0; i < 17; i++) codes.push((await type("ZZZZZZ", c)).statusCode);
    expect(codes.at(-1)).toBe(429);
  });

  it("a new QR, a removed table and a suspended restaurant stop the code", async () => {
    const t = await owner.ok<T>("POST", "/v1/admin/tables", { label: "P2" });
    const rotated = await owner.ok<T>("POST", `/v1/admin/tables/${t.id}/rotate-qr`);
    expect(rotated.code).not.toBe(t.code);
    expect((await type(t.code)).statusCode).toBe(404);
    expect((await type(rotated.code)).statusCode).toBe(200);
    await owner.ok("DELETE", `/v1/admin/tables/${t.id}`);
    expect((await type(rotated.code)).statusCode).toBe(404);
    await admin.ok("PATCH", `/v1/platform/hotels/${hotelId}`, { status: "SUSPENDED" });
    expect((await type(table.code)).statusCode).toBeGreaterThanOrEqual(400);
    await admin.ok("PATCH", `/v1/platform/hotels/${hotelId}`, { status: "ACTIVE" });
    expect((await type(table.code)).statusCode).toBe(200);
  });

  it("the QR sheet is a PDF", async () => {
    const r = await owner.req("GET", "/v1/admin/tables/qr-sheet.pdf");
    expect(r.statusCode).toBe(200);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
  });

  /** A walk-in customer's own phone, joined at the parcel counter. */
  async function walkIn(counter: T, n: number) {
    const c = new Client(app);
    const j = await c.ok<{ session: SessionView }>("POST", "/v1/p/sessions/join", { qrToken: counter.qrToken, deviceId: `walk-in-${n}-xx`, name: `W${n}` });
    return { c, session: j.session };
  }
  const order = (c: Client, payment = "PAY_LATER") => c.ok<OrderView>("POST", "/v1/p/orders", { clientId: cid(), payment });
  const serve = async (o: OrderView) => {
    for (const i of o.items) for (const to of ["READY", "PICKED_UP"]) await owner.ok("POST", `/v1/s/order-items/${i.id}/transition`, { clientId: cid(), to });
  };
  const ready = async () => (await owner.ok<WaiterBoard>("GET", "/v1/s/waiter/board")).ready;
  const payCash = async (c: Client) => {
    const bill = await c.ok<BillView>("GET", "/v1/p/bill");
    return owner.ok<BillView>("POST", "/v1/s/payments", { clientId: cid(), billId: bill.id, method: "CASH", amount: bill.due });
  };

  it("walk-in: many customers order at once on one QR, each with their own token, cart and bill", async () => {
    const counter = await owner.ok<T>("POST", "/v1/admin/tables", { label: "Parcel counter", isParcelCounter: true });
    const [a, b2] = await Promise.all([walkIn(counter, 1), walkIn(counter, 2)]);
    expect(a.session.isParcel).toBe(true);
    expect(a.session.joinCode).toBeNull();
    expect(a.session.tableLabel).toMatch(/^Parcel \d+$/);
    expect(a.session.tableLabel).not.toBe(b2.session.tableLabel);
    expect((await walkIn(counter, 1)).session.id).toBe(a.session.id); // same phone, same order
    const look = await new Client(app).ok<{ hasOpenSession: boolean }>("GET", `/v1/p/t/${counter.qrToken}?deviceId=walk-in-9-xx`);
    expect(look.hasOpenSession).toBe(false);

    await a.c.ok("PUT", `/v1/p/cart/items/${cid()}`, { itemId: naan, quantity: 2, isParcel: false }); // packed anyway
    expect((await b2.c.ok<SessionView>("GET", "/v1/p/session")).cart.items).toHaveLength(0);
    const o = await order(a.c);
    expect(o.items[0]?.isParcel).toBe(true);
    expect(o.tableLabel).toBe(a.session.tableLabel);
    expect((await b2.c.ok<OrderView[]>("GET", "/v1/p/orders"))).toHaveLength(0);

    await serve(o);
    expect((await ready()).find((i) => i.orderId === o.id)).toMatchObject({ tableLabel: a.session.tableLabel, unpaid: true });
    expect((await payCash(a.c)).status).toBe("PAID");
    expect((await ready()).find((i) => i.orderId === o.id)).toMatchObject({ unpaid: false }); // paid, still to hand over
    expect((await a.c.ok<OrderView[]>("GET", "/v1/p/orders"))[0]?.items[0]?.status).toBe("PICKED_UP"); // guest can still follow it
    expect((await a.c.req("POST", "/v1/p/orders", { clientId: cid(), payment: "PAY_LATER" })).statusCode).toBe(401); // but not order on it
    expect((await b2.c.req("GET", "/v1/p/session")).statusCode).toBe(200); // the other customer is untouched
    const tables = await owner.ok<{ id: string; status: string }[]>("GET", "/v1/admin/tables");
    expect(tables.find((t) => t.id === counter.id)?.status).toBe("FREE"); // a counter is never "cleaning"
    expect((await walkIn(counter, 1)).session.id).not.toBe(a.session.id); // next visit, new token

    // staff take walk-in orders too: one per customer
    const taken = await Promise.all([1, 2].map(() => owner.ok<OrderView>("POST", "/v1/s/orders", { clientId: cid(), tableId: counter.id, lines: [{ itemId: naan, quantity: 1 }] })));
    expect(taken[0]?.sessionId).not.toBe(taken[1]?.sessionId);
    expect(taken.every((x) => x.items[0]?.isParcel)).toBe(true);
    await owner.ok("GET", "/v1/s/floor");
    expect((await owner.req("PATCH", `/v1/admin/tables/${counter.id}`, { isParcelCounter: false })).statusCode).toBe(409);
  });

  it("ate here, ordered a parcel, paid and waits: the parcel stays with the waiter, eaten dishes don't come back", async () => {
    const t = await owner.ok<T>("POST", "/v1/admin/tables", { label: "P5" });
    const c = new Client(app);
    await c.ok("POST", "/v1/p/sessions/join", { qrToken: t.qrToken, deviceId: "eat-then-go-1", name: "Om" });
    await c.ok("PUT", `/v1/p/cart/items/${cid()}`, { itemId: naan, quantity: 1 });
    const eaten = await order(c);
    await serve(eaten); // carried, nobody tapped Served
    await c.ok("PUT", `/v1/p/cart/items/${cid()}`, { itemId: naan, quantity: 2, isParcel: true });
    const parcel = await order(c);
    expect((await payCash(c)).status).toBe("PAID");
    for (const i of parcel.items) await owner.ok("POST", `/v1/s/order-items/${i.id}/transition`, { clientId: cid(), to: "READY" });
    const list = await ready();
    expect(list.some((i) => i.orderId === parcel.id)).toBe(true);
    expect(list.some((i) => i.orderId === eaten.id)).toBe(false);
    for (const i of parcel.items) await owner.ok("POST", `/v1/s/order-items/${i.id}/transition`, { clientId: cid(), to: "SERVED" });
    expect((await ready()).some((i) => i.orderId === parcel.id)).toBe(false);
  });

  it("dine-in guests who pay before their food comes still get it, until the table is cleared", async () => {
    const t = await owner.ok<T>("POST", "/v1/admin/tables", { label: "P6" });
    const c = new Client(app);
    await c.ok("POST", "/v1/p/sessions/join", { qrToken: t.qrToken, deviceId: "pays-early-01", name: "Uma" });
    await c.ok("PUT", `/v1/p/cart/items/${cid()}`, { itemId: naan, quantity: 1 });
    const o = await order(c);
    const id = o.items[0]!.id;
    await payCash(c);
    const onList = async () => (await ready()).some((i) => i.orderId === o.id);
    const to = (s: string) => owner.ok("POST", `/v1/s/order-items/${id}/transition`, { clientId: cid(), to: s });
    expect(await onList()).toBe(false);
    await to("READY");
    expect(await onList()).toBe(true);
    await to("PICKED_UP");
    expect(await onList()).toBe(true); // so it can be marked served
    await owner.ok("POST", `/v1/s/tables/${t.id}/status`, { status: "FREE" });
    expect(await onList()).toBe(false); // next guests never see it
  });

  it("paying never loses an order that still waits for the waiter", async () => {
    await owner.ok("PATCH", "/v1/admin/hotel", { requireWaiterConfirm: true });
    const board = () => owner.ok<WaiterBoard>("GET", "/v1/s/waiter/board");
    const t = await owner.ok<T>("POST", "/v1/admin/tables", { label: "P7" });
    const first = await owner.ok<OrderView>("POST", "/v1/s/orders", { clientId: cid(), tableId: t.id, lines: [{ itemId: naan, quantity: 1 }] });
    await unscopedDb.tableSession.update({ where: { id: first.sessionId }, data: { isConfirmed: false } });
    const { joinCode } = await unscopedDb.tableSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    const c = new Client(app);
    await c.ok("POST", "/v1/p/sessions/join", { qrToken: t.qrToken, deviceId: "pending-dev-1", name: "Jay", joinCode });
    await c.ok("PUT", `/v1/p/cart/items/${cid()}`, { itemId: naan, quantity: 1 });
    const held = await order(c);
    expect(held.status).toBe("PENDING_CONFIRMATION");

    expect((await payCash(c)).status).not.toBe("PAID"); // fully paid, but not closed
    expect((await board()).pendingOrders.some((p) => p.id === held.id)).toBe(true);
    for (const r of [await c.req("POST", "/v1/p/session/leave"), await owner.req("POST", `/v1/s/sessions/${first.sessionId}/close`)]) {
      expect(r.statusCode).toBe(409);
      expect(r.json().error.code).toBe("ORDER_PENDING");
    }
    await owner.ok("POST", `/v1/s/orders/${held.id}/reject`, { reason: "Kitchen closed" });
    expect((await unscopedDb.tableSession.findUniqueOrThrow({ where: { id: first.sessionId } })).status).toBe("CLOSED");
    await owner.ok("PATCH", "/v1/admin/hotel", { requireWaiterConfirm: false });
  });

  it("parcel follows the dish from cart to order, bill and waiter orders", async () => {
    const guest = new Client(app);
    await guest.ok("POST", "/v1/p/sessions/join", { qrToken: table.qrToken, deviceId: "parcel-dev-01", name: "Ila" });
    await guest.ok("PUT", `/v1/p/cart/items/${cid()}`, { itemId: naan, quantity: 2, isParcel: true });
    const line = cid();
    await guest.ok("PUT", `/v1/p/cart/items/${line}`, { itemId: naan, quantity: 1 });
    const s = await guest.ok<SessionView>("GET", "/v1/p/session");
    expect(s.cart.items.map((i) => i.isParcel).sort()).toEqual([false, true]);
    expect((await guest.req("PUT", `/v1/p/cart/items/${line}`, { itemId: naan, quantity: 1, isParcel: "yes" })).statusCode).toBe(400);

    const order = await guest.ok<OrderView>("POST", "/v1/p/orders", { clientId: cid(), payment: "PAY_LATER" });
    expect(order.items.find((i) => i.quantity === 2)?.isParcel).toBe(true);
    expect(order.items.find((i) => i.quantity === 1)?.isParcel).toBe(false);
    const bill = await guest.ok<BillView>("GET", "/v1/p/bill");
    expect(bill.lines.find((l) => l.quantity === 2)?.isParcel).toBe(true);

    await owner.ok("POST", "/v1/s/orders", { clientId: cid(), tableId: table.id, lines: [{ itemId: naan, quantity: 3, isParcel: true }] });
    const orders = await guest.ok<OrderView[]>("GET", "/v1/p/orders");
    expect(orders.flatMap((o) => o.items).find((i) => i.quantity === 3)?.isParcel).toBe(true);
  });
});
