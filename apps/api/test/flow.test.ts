import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { unscopedDb } from "@rms/db";
import type { BillView, KdsTicket, OrderView, SessionView } from "@rms/contracts";
import { closeQueue } from "../src/jobs/queue";
import { Client, cid, createHotel, createPlatformAdmin, getApp, resetDb, staffOnDevice } from "./helpers";

/**
 * Phase 1 happy path over the real HTTP surface:
 * setup → scan → shared cart → order → cook → pick up → serve → bill → pay → table freed.
 */
describe("scan → order → cook → serve → pay", () => {
  let app: FastifyInstance;
  let owner: Client;
  let cook: Client;
  let waiter: Client;
  let cashier: Client;
  let qrToken: string;
  let tableId: string;
  let paneerId: string;
  let naanId: string;
  let halfId: string;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    const admin = await createPlatformAdmin(app);
    ({ owner } = await createHotel(app, admin, "flow-hotel"));

    // Manager setup
    const taxes = await owner.ok<{ id: string }[]>("GET", "/v1/admin/taxes");
    const tandoor = await owner.ok<{ id: string }>("POST", "/v1/admin/stations", { name: "Tandoor" });
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Mains" });
    const paneer = await owner.ok<{ id: string; variants: { id: string; name: string }[] }>("POST", "/v1/admin/items", {
      categoryId: cat.id,
      stationId: tandoor.id,
      name: "Paneer Tikka",
      price: 26000,
      prepTimeMin: 15,
      taxIds: taxes.map((t) => t.id),
      variants: [
        { name: "Half", price: 18000 },
        { name: "Full", price: 26000 },
      ],
    });
    paneerId = paneer.id;
    halfId = paneer.variants.find((v) => v.name === "Half")!.id;
    const naan = await owner.ok<{ id: string }>("POST", "/v1/admin/items", {
      categoryId: cat.id,
      stationId: tandoor.id,
      name: "Butter Naan",
      price: 6000,
      taxIds: taxes.map((t) => t.id),
    });
    naanId = naan.id;
    const table = await owner.ok<{ id: string; qrToken: string }>("POST", "/v1/admin/tables", { label: "T1" });
    tableId = table.id;
    qrToken = table.qrToken;

    const mk = (name: string, role: string, pin: string, extra: object = {}) =>
      owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name, role, pin, ...extra });
    const cookStaff = await mk("Raju", "COOK", "3001", { stationId: tandoor.id });
    const waiterStaff = await mk("Ravi", "WAITER", "4001");
    const cashierStaff = await mk("Kavya", "CASHIER", "2000");
    cook = await staffOnDevice(owner, "KDS", cookStaff.id, "3001", tandoor.id);
    waiter = await staffOnDevice(owner, "WAITER", waiterStaff.id, "4001");
    cashier = await staffOnDevice(owner, "POS", cashierStaff.id, "2000");
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  it("runs the full table lifecycle", async () => {
    // ── Scan & join ──
    const host = new Client(app);
    const look = await host.ok<{ hasOpenSession: boolean }>("GET", `/v1/p/t/${qrToken}?deviceId=device-host-0001`);
    expect(look.hasOpenSession).toBe(false);
    const joined = await host.ok<{ session: SessionView }>("POST", "/v1/p/sessions/join", {
      qrToken,
      deviceId: "device-host-0001",
      name: "Rahul",
    });
    expect(joined.session.me.isHost).toBe(true);
    const code = joined.session.joinCode!;
    expect(code).toMatch(/^\d{4}$/);

    // A second phone needs the join code (anti-prank)
    const friend = new Client(app);
    const noCode = await friend.req("POST", "/v1/p/sessions/join", { qrToken, deviceId: "device-friend-01", name: "Asha" });
    expect(noCode.statusCode).toBe(403);
    expect(noCode.json().error.code).toBe("JOIN_CODE_REQUIRED");
    const wrong = await friend.req("POST", "/v1/p/sessions/join", { qrToken, deviceId: "device-friend-01", name: "Asha", joinCode: code === "0000" ? "1111" : "0000" });
    expect(wrong.json().error.code).toBe("JOIN_CODE_INVALID");
    const fj = await friend.ok<{ session: SessionView }>("POST", "/v1/p/sessions/join", { qrToken, deviceId: "device-friend-01", name: "Asha", joinCode: code });
    expect(fj.session.joinCode).toBeNull(); // only the host sees it
    expect(fj.session.guests).toHaveLength(2);

    // ── Shared cart (server prices it) ──
    await host.ok("PUT", "/v1/p/cart/items/cart-line-0001", { itemId: paneerId, variantId: halfId, quantity: 2 });
    const afterFriend = await friend.ok<SessionView>("PUT", "/v1/p/cart/items/cart-line-0002", { itemId: naanId, quantity: 1, note: "extra crisp" });
    expect(afterFriend.cart.items).toHaveLength(2);
    expect(afterFriend.cart.subtotal).toBe(2 * 18000 + 6000);
    const bad = await host.req("PUT", "/v1/p/cart/items/cart-line-0003", { itemId: paneerId, quantity: 1 });
    expect(bad.json().error.code).toBe("ITEM_UNAVAILABLE"); // variant required

    // ── Checkout is idempotent ──
    const clientId = cid();
    const first = await host.req("POST", "/v1/p/orders", { clientId, payment: "PAY_LATER" });
    expect(first.statusCode).toBe(201);
    const order = first.json() as OrderView;
    expect(order.status).toBe("PLACED");
    expect(order.orderNumber).toBe(1);
    expect(order.items).toHaveLength(2);
    const retry = await host.req("POST", "/v1/p/orders", { clientId, payment: "PAY_LATER" });
    expect(retry.statusCode).toBe(200);
    expect((retry.json() as OrderView).id).toBe(order.id);
    expect((await host.ok<SessionView>("GET", "/v1/p/session")).cart.items).toHaveLength(0);
    expect(await unscopedDb.order.count()).toBe(1);

    // ── Kitchen ──
    const tickets = await cook.ok<KdsTicket[]>("GET", "/v1/s/kds");
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.items.every((i) => i.prepTimeMin > 0)).toBe(true);
    const [paneerLine, naanLine] = order.items;
    expect(await cook.ok("POST", `/v1/s/order-items/${paneerLine!.id}/transition`, { clientId: cid(), to: "COOKING" })).toEqual({ outcome: "APPLIED" });
    // Cook can't do waiter's job
    const forbidden = await cook.req("POST", `/v1/s/order-items/${paneerLine!.id}/transition`, { clientId: cid(), to: "SERVED" });
    expect(forbidden.statusCode).toBe(403);
    expect(await cook.ok("POST", `/v1/s/orders/${order.id}/bump`)).toEqual({ applied: 2 });
    // Stale offline replay is harmless
    expect(await cook.ok("POST", `/v1/s/order-items/${paneerLine!.id}/transition`, { clientId: cid(), to: "COOKING" })).toEqual({ outcome: "NOOP" });

    const tracked = await host.ok<OrderView[]>("GET", "/v1/p/orders");
    expect(tracked[0]!.status).toBe("READY");

    // ── Waiter ──
    const board = await waiter.ok<{ ready: unknown[]; tables: { id: string; session: unknown }[] }>("GET", "/v1/s/waiter/board");
    expect(board.ready).toHaveLength(2);
    for (const line of [paneerLine!, naanLine!]) {
      await waiter.ok("POST", `/v1/s/order-items/${line.id}/transition`, { clientId: cid(), to: "PICKED_UP" });
      await waiter.ok("POST", `/v1/s/order-items/${line.id}/transition`, { clientId: cid(), to: "SERVED" });
    }
    expect((await host.ok<OrderView[]>("GET", "/v1/p/orders"))[0]!.status).toBe("SERVED");

    // ── Requests dedupe ──
    const r1 = await friend.ok<{ id: string }>("POST", "/v1/p/requests", { clientId: cid(), type: "BILL" });
    const r2 = await host.ok<{ id: string }>("POST", "/v1/p/requests", { clientId: cid(), type: "BILL" });
    expect(r2.id).toBe(r1.id);
    expect((await unscopedDb.table.findUniqueOrThrow({ where: { id: tableId } })).status).toBe("BILL_REQUESTED");

    // ── Bill: (2×180 + 60) = ₹420, GST 5% = ₹21 → ₹441 ──
    const live = await cashier.ok<BillView[]>("GET", "/v1/s/bills/live");
    expect(live).toHaveLength(1);
    const bill = live[0]!;
    expect(bill.subtotal).toBe(42000);
    expect(bill.taxLines.map((t) => [t.name, t.amount])).toEqual([
      ["CGST", 1050],
      ["SGST", 1050],
    ]);
    expect(bill.total).toBe(44100);
    expect(bill.lines).toHaveLength(2);

    // Overpay rejected, then partial cash + full rest
    const over = await cashier.req("POST", "/v1/s/payments", { clientId: cid(), billId: bill.id, method: "CASH", amount: 50000 });
    expect(over.json().error.code).toBe("AMOUNT_EXCEEDS_DUE");
    const partial = await cashier.ok<BillView>("POST", "/v1/s/payments", { clientId: cid(), billId: bill.id, method: "CARD", amount: 10000 });
    expect(partial.status).toBe("PARTIALLY_PAID");
    expect(partial.due).toBe(34100);
    const cashId = cid();
    const paid = await cashier.ok<BillView>("POST", "/v1/s/payments", { clientId: cashId, billId: bill.id, method: "CASH", amount: 34100 });
    expect(paid.status).toBe("PAID");
    expect(paid.billNumber).toMatch(/^INV\/\d{4}\/00001$/);
    // retry of the same payment doesn't double-charge
    await cashier.ok("POST", "/v1/s/payments", { clientId: cashId, billId: bill.id, method: "CASH", amount: 34100 });
    expect(await unscopedDb.payment.count({ where: { status: "SUCCESS" } })).toBe(2);

    // ── Close: session ends, QR starts fresh, table → cleaning → free ──
    expect((await host.req("GET", "/v1/p/session")).statusCode).toBe(401);
    expect((await unscopedDb.table.findUniqueOrThrow({ where: { id: tableId } })).status).toBe("CLEANING");
    await waiter.ok("POST", `/v1/s/tables/${tableId}/status`, { status: "FREE" });
    const fresh = await new Client(app).ok<{ hasOpenSession: boolean }>("GET", `/v1/p/t/${qrToken}`);
    expect(fresh.hasOpenSession).toBe(false);
  });

  it("rejects checkout when an item went out of stock, and pays by mock UPI", async () => {
    const guest = new Client(app);
    await guest.ok("POST", "/v1/p/sessions/join", { qrToken, deviceId: "device-upi-00001", name: "Meera" });
    await guest.ok("PUT", "/v1/p/cart/items/cart-upi-0001", { itemId: naanId, quantity: 2 });

    await cook.ok("PATCH", `/v1/s/menu-items/${naanId}/availability`, { isAvailable: false });
    const blocked = await guest.req("POST", "/v1/p/orders", { clientId: cid(), payment: "PAY_LATER" });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("ITEM_UNAVAILABLE");
    await cook.ok("PATCH", `/v1/s/menu-items/${naanId}/availability`, { isAvailable: true });

    const order = await guest.ok<OrderView>("POST", "/v1/p/orders", { clientId: cid(), payment: "PAY_LATER" });
    expect(order.orderNumber).toBe(2);
    const bill = await guest.ok<BillView>("GET", "/v1/p/bill");
    expect(bill.total).toBe(12600); // 120 + 6 GST

    const checkout = await guest.ok<{ paymentId: string; gatewayOrderId: string; amount: number }>("POST", "/v1/p/payments/upi", {
      clientId: cid(),
      target: { kind: "BILL", billId: bill.id },
    });
    expect(checkout.amount).toBe(12600);
    const bad = await guest.req("POST", `/v1/p/payments/${checkout.paymentId}/verify`, { gatewayPaymentId: "pay_x", signature: "nope" });
    expect(bad.json().error.code).toBe("BAD_SIGNATURE");
    const sig = await guest.ok<{ gatewayPaymentId: string; signature: string }>("POST", `/v1/dev/payments/${checkout.paymentId}/succeed`);
    await guest.ok("POST", `/v1/p/payments/${checkout.paymentId}/verify`, sig);

    const b = await unscopedDb.bill.findUniqueOrThrow({ where: { id: bill.id } });
    expect(b.status).toBe("PAID");
    expect(b.billNumber).toMatch(/00002$/);
  });
});
