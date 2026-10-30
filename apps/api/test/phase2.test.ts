import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { unscopedDb } from "@rms/db";
import type { BillView, DayReport, FloorView, OrderView, ReceiptView, SendBillResult } from "@rms/contracts";
import { closeQueue } from "../src/jobs/queue";
import { Client, cid, createHotel, createPlatformAdmin, getApp, resetDb, staffOnDevice } from "./helpers";

/**
 * Phase 2: pay-now, split bills, the one-payment-at-a-time lock, out-of-stock replacement,
 * digital receipts, floor view and the end-of-day report.
 * Menu: Naan ₹60, Dal ₹200, both 5% GST, no service charge.
 */
describe("phase 2 flows", () => {
  let app: FastifyInstance;
  let owner: Client;
  let cook: Client;
  let waiter: Client;
  let cashier: Client;
  let naanId: string;
  let dalId: string;
  let tables: { id: string; qrToken: string }[];
  let next = 0;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    const admin = await createPlatformAdmin(app);
    ({ owner } = await createHotel(app, admin, "phase-two"));
    const taxes = await owner.ok<{ id: string }[]>("GET", "/v1/admin/taxes");
    const kitchen = await owner.ok<{ id: string }>("POST", "/v1/admin/stations", { name: "Curry" });
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Mains" });
    const item = (name: string, price: number) =>
      owner.ok<{ id: string }>("POST", "/v1/admin/items", { categoryId: cat.id, stationId: kitchen.id, name, price, taxIds: taxes.map((t) => t.id) });
    naanId = (await item("Naan", 6000)).id;
    dalId = (await item("Dal", 20000)).id;
    tables = [];
    for (const label of ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]) tables.push(await owner.ok("POST", "/v1/admin/tables", { label }));
    const mk = (name: string, role: string, pin: string, extra: object = {}) => owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name, role, pin, ...extra });
    cook = await staffOnDevice(owner, "KDS", (await mk("Cook", "COOK", "3001", { stationId: kitchen.id })).id, "3001", kitchen.id);
    waiter = await staffOnDevice(owner, "WAITER", (await mk("Waiter", "WAITER", "4001")).id, "4001");
    cashier = await staffOnDevice(owner, "POS", (await mk("Cashier", "CASHIER", "2000")).id, "2000");
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  let table: { id: string; qrToken: string };
  beforeEach(() => {
    const t = tables[next++];
    if (!t) throw new Error("out of test tables");
    table = t;
  });

  async function seat(names: string[]): Promise<Client[]> {
    const host = new Client(app);
    const j = await host.ok<{ session: { joinCode: string } }>("POST", "/v1/p/sessions/join", { qrToken: table.qrToken, deviceId: `dev-${table.id}-0`, name: names[0] });
    const guests = [host];
    for (const [i, name] of names.slice(1).entries()) {
      const g = new Client(app);
      await g.ok("POST", "/v1/p/sessions/join", { qrToken: table.qrToken, deviceId: `dev-${table.id}-${i + 1}`, name, joinCode: j.session.joinCode });
      guests.push(g);
    }
    return guests;
  }

  async function order(guest: Client, lines: [string, number][], payment: "PAY_LATER" | "PAY_NOW" = "PAY_LATER") {
    for (const [itemId, quantity] of lines) await guest.ok("PUT", `/v1/p/cart/items/${cid()}`, { itemId, quantity });
    return guest.ok<OrderView>("POST", "/v1/p/orders", { clientId: cid(), payment });
  }

  async function payUpi(guest: Client, target: object) {
    const co = await guest.ok<{ paymentId: string; amount: number }>("POST", "/v1/p/payments/upi", { clientId: cid(), target });
    const sig = await guest.ok("POST", `/v1/dev/payments/${co.paymentId}/succeed`);
    await guest.ok("POST", `/v1/p/payments/${co.paymentId}/verify`, sig);
    return co;
  }

  it("pay now: order is held until UPI succeeds, then goes to the kitchen; leaving closes the table", async () => {
    const [guest] = await seat(["Anu"]);
    const held = await order(guest!, [[naanId, 2]], "PAY_NOW");
    expect(held.status).toBe("AWAITING_PAYMENT");
    expect((await cook.ok<unknown[]>("GET", "/v1/s/kds")).length).toBe(0); // kitchen doesn't see unpaid orders
    expect((await guest!.ok<BillView>("GET", "/v1/p/bill")).total).toBe(0);

    const co = await payUpi(guest!, { kind: "ORDER", orderId: held.id });
    expect(co.amount).toBe(12600); // ₹120 + 5%
    const [released] = await guest!.ok<OrderView[]>("GET", "/v1/p/orders");
    expect(released!.status).toBe("PLACED");
    const bill = await guest!.ok<BillView>("GET", "/v1/p/bill");
    expect(bill).toMatchObject({ total: 12600, paid: 12600, due: 0, status: "OPEN" }); // still eating: table stays open

    // second pay-now order: amount = new total − paid, so rounding never drifts
    const more = await order(guest!, [[dalId, 1]], "PAY_NOW");
    const co2 = await payUpi(guest!, { kind: "ORDER", orderId: more.id });
    expect(co2.amount).toBe(21000 + 12600 - 12600);
    expect((await guest!.ok<BillView>("GET", "/v1/p/bill")).due).toBe(0);

    // asking for the bill doesn't close the table; "we're leaving" does, with an invoice number
    await guest!.ok("POST", "/v1/p/requests", { clientId: cid(), type: "BILL" });
    expect((await unscopedDb.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("OPEN");
    const left = await guest!.ok<{ receiptUrl: string }>("POST", "/v1/p/session/leave");
    expect(left.receiptUrl).toContain("/r/");
    const t = await unscopedDb.table.findUniqueOrThrow({ where: { id: table.id } });
    expect(t.status).toBe("CLEANING");
    const b = await unscopedDb.bill.findFirstOrThrow({ where: { id: bill.id } });
    expect(b.status).toBe("PAID");
    expect(b.billNumber).toMatch(/^INV\/\d{4}\/\d{5}$/);
  });

  it("pay now: an unpaid order can be cancelled; a paid one can't", async () => {
    const [guest] = await seat(["Bala"]);
    const held = await order(guest!, [[naanId, 1]], "PAY_NOW");
    await guest!.ok("POST", `/v1/p/orders/${held.id}/cancel`);
    const [o] = await guest!.ok<OrderView[]>("GET", "/v1/p/orders");
    expect(o!.status).toBe("CANCELLED");
    const paid = await order(guest!, [[naanId, 1]], "PAY_NOW");
    await payUpi(guest!, { kind: "ORDER", orderId: paid.id });
    expect((await guest!.req("POST", `/v1/p/orders/${paid.id}/cancel`)).json().error.code).toBe("PAYMENT_IN_PROGRESS");
  });

  it("only one guest can pay the full bill at a time; cancelling releases the lock", async () => {
    const [a, b] = await seat(["Chitra", "Dev"]);
    await order(a!, [[dalId, 1]]);
    const bill = await a!.ok<BillView>("GET", "/v1/p/bill");
    const first = await a!.ok<{ paymentId: string }>("POST", "/v1/p/payments/upi", { clientId: cid(), target: { kind: "BILL", billId: bill.id } });
    const second = await b!.req("POST", "/v1/p/payments/upi", { clientId: cid(), target: { kind: "BILL", billId: bill.id } });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("PAYMENT_IN_PROGRESS");
    expect((await cashier.ok<BillView>("GET", `/v1/s/sessions/${bill.sessionId}/bill`)).paymentInFlight).toBe(true);
    const cash = await cashier.req("POST", "/v1/s/payments", { clientId: cid(), billId: bill.id, method: "CASH", amount: bill.due });
    expect(cash.json().error.code).toBe("PAYMENT_IN_PROGRESS");

    await a!.ok("POST", `/v1/p/payments/${first.paymentId}/cancel`);
    const co = await payUpi(b!, { kind: "BILL", billId: bill.id });
    expect(co.amount).toBe(21000);
    expect((await unscopedDb.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe("PAID");
  });

  it("split by guest: each pays their share, by UPI or at the counter", async () => {
    const [a, b] = await seat(["Esha", "Farhan"]);
    await order(a!, [[dalId, 1]]); // ₹200
    await order(b!, [[naanId, 1]]); // ₹60
    const bill = await cashier.ok<BillView>("GET", `/v1/s/sessions/${(await a!.ok<BillView>("GET", "/v1/p/bill")).sessionId}/bill`);
    expect(bill.total).toBe(27300);

    const split = await waiter.ok<BillView>("POST", `/v1/s/bills/${bill.id}/split`, { type: "BY_GUEST" });
    expect(split.splitType).toBe("BY_GUEST");
    const esha = split.splits.find((s) => s.label === "Esha")!;
    const farhan = split.splits.find((s) => s.label === "Farhan")!;
    expect(esha.amount + farhan.amount).toBe(27300);
    expect(esha.amount).toBe(21000);
    expect(split.lines.every((l) => l.splitId)).toBe(true);

    // whole-bill UPI is refused once split; two different splits can be paid in parallel
    expect((await a!.req("POST", "/v1/p/payments/upi", { clientId: cid(), target: { kind: "BILL", billId: bill.id } })).json().error.code).toBe("BILL_SPLIT");
    const coA = await a!.ok<{ paymentId: string; amount: number }>("POST", "/v1/p/payments/upi", { clientId: cid(), target: { kind: "BILL", billId: bill.id, splitId: esha.id } });
    expect(coA.amount).toBe(21000);
    const sameSplit = await b!.req("POST", "/v1/p/payments/upi", { clientId: cid(), target: { kind: "BILL", billId: bill.id, splitId: esha.id } });
    expect(sameSplit.json().error.code).toBe("PAYMENT_IN_PROGRESS");
    const sig = await a!.ok("POST", `/v1/dev/payments/${coA.paymentId}/succeed`);
    await a!.ok("POST", `/v1/p/payments/${coA.paymentId}/verify`, sig);

    // re-splitting after someone paid is refused
    expect((await cashier.req("POST", `/v1/s/bills/${bill.id}/split`, { type: "EQUAL", parts: 2 })).json().error.code).toBe("SPLIT_LOCKED");

    // Farhan pays cash at the counter; more than his share is refused
    const over = await cashier.req("POST", "/v1/s/payments", { clientId: cid(), billId: bill.id, splitId: farhan.id, method: "CASH", amount: farhan.amount + 100 });
    expect(over.json().error.code).toBe("AMOUNT_EXCEEDS_DUE");
    const done = await cashier.ok<BillView>("POST", "/v1/s/payments", { clientId: cid(), billId: bill.id, splitId: farhan.id, method: "CASH", amount: farhan.amount });
    expect(done.status).toBe("PAID");
    expect(done.splits.every((s) => s.isPaid)).toBe(true);
    expect(done.receiptUrl).toMatch(/\/r\/.+\..+/);

    // digital receipt: signed link works, tampered one doesn't
    const token = done.receiptUrl!.split("/r/")[1]!;
    const receipt = await new Client(app).ok<ReceiptView>("GET", `/v1/r/${token}`);
    expect(receipt.bill.billNumber).toBe(done.billNumber);
    expect(receipt.payments.map((p) => p.method).sort()).toEqual(["CASH", "UPI"]);
    expect((await new Client(app).req("GET", `/v1/r/${bill.id}.forgedsignature000000`)).statusCode).toBe(404);

    const sent = await cashier.ok<SendBillResult>("POST", `/v1/s/bills/${bill.id}/send`, { phone: "9876543210" });
    expect(sent.whatsappUrl).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
    expect(sent.smsUrl).toMatch(/^sms:\+919876543210/);
  });

  it("equal split absorbs paise exactly; adding food afterwards keeps paid parts and re-splits the rest", async () => {
    const [a] = await seat(["Gita"]);
    await order(a!, [[dalId, 1]]); // ₹210 total
    const bill = await a!.ok<BillView>("GET", "/v1/p/bill");
    const s = await cashier.ok<BillView>("POST", `/v1/s/bills/${bill.id}/split`, { type: "EQUAL", parts: 3 });
    expect(s.splits.map((x) => x.amount)).toEqual([7000, 7000, 7000]);
    await cashier.ok("POST", "/v1/s/payments", { clientId: cid(), billId: bill.id, splitId: s.splits[0]!.id, method: "CASH", amount: 7000 });

    await order(a!, [[naanId, 1]]); // +₹63
    const after = await a!.ok<BillView>("GET", "/v1/p/bill");
    expect(after.total).toBe(27300);
    expect(after.splits.map((x) => [x.label, x.amount, x.isPaid])).toEqual([
      ["Part 1 of 3", 7000, true],
      ["Remaining", 20300, false],
    ]);
  });

  it("split by item must cover every line exactly once", async () => {
    const [a] = await seat(["Hari"]);
    await order(a!, [[dalId, 1], [naanId, 1]]);
    const bill = await a!.ok<BillView>("GET", "/v1/p/bill");
    const [l1, l2] = bill.lines;
    const missing = await cashier.req("POST", `/v1/s/bills/${bill.id}/split`, { type: "BY_ITEM", groups: [{ label: "x", orderItemIds: [l1!.orderItemId] }, { label: "y", orderItemIds: [l1!.orderItemId] }] });
    expect(missing.json().error.code).toBe("ITEM_TWICE");
    const ok = await cashier.ok<BillView>("POST", `/v1/s/bills/${bill.id}/split`, {
      type: "BY_ITEM",
      groups: [
        { label: "Dal", orderItemIds: [l1!.orderItemId] },
        { label: "Naan", orderItemIds: [l2!.orderItemId] },
      ],
    });
    expect(ok.splits.reduce((sum, x) => sum + x.amount, 0)).toBe(bill.total);
    const undone = await cashier.ok<BillView>("POST", `/v1/s/bills/${bill.id}/split`, { type: "NONE" });
    expect(undone.splits).toHaveLength(0);
    expect(undone.lines.every((l) => l.splitId === null)).toBe(true);
  });

  it("out of stock: guest swaps the item, kitchen gets the replacement on the same ticket", async () => {
    const [a] = await seat(["Isha"]);
    const o = await order(a!, [[dalId, 2]]);
    const dalLine = o.items[0]!;
    await cook.ok("POST", `/v1/s/order-items/${dalLine.id}/transition`, { clientId: cid(), to: "OUT_OF_STOCK" });
    expect((await a!.ok<BillView>("GET", "/v1/p/bill")).total).toBe(0);

    const r = await a!.ok<{ replacementId: string }>("POST", `/v1/p/order-items/${dalLine.id}/replace`, { clientId: cid(), itemId: naanId });
    const again = await a!.ok<{ replacementId: string }>("POST", `/v1/p/order-items/${dalLine.id}/replace`, { clientId: cid(), itemId: naanId });
    expect(again.replacementId).toBe(r.replacementId); // idempotent

    const [updated] = await a!.ok<OrderView[]>("GET", "/v1/p/orders");
    expect(updated!.items.map((i) => [i.name, i.quantity, i.status])).toEqual([
      ["Dal", 2, "CANCELLED"],
      ["Naan", 2, "QUEUED"],
    ]);
    const tickets = await cook.ok<{ orderNumber: number; items: { name: string }[] }[]>("GET", "/v1/s/kds");
    expect(tickets.find((t) => t.orderNumber === o.orderNumber)!.items.map((i) => i.name)).toEqual(["Naan"]);
    expect((await a!.ok<BillView>("GET", "/v1/p/bill")).total).toBe(12600);
    // only OUT_OF_STOCK items can be swapped
    expect((await a!.req("POST", `/v1/p/order-items/${r.replacementId}/replace`, { clientId: cid(), itemId: dalId })).json().error.code).toBe("NOT_OUT_OF_STOCK");
  });

  it("floor view and end-of-day report add up", async () => {
    const floor = await owner.ok<FloorView>("GET", "/v1/s/floor");
    const live = floor.tables.filter((t) => t.session);
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((t) => t.session!.total >= t.session!.due)).toBe(true);
    expect((await waiter.req("GET", "/v1/s/floor")).statusCode).toBe(403);

    await owner.ok("PUT", "/v1/admin/tables/positions", { tables: [{ id: tables[0]!.id, posX: 10, posY: 20 }] });
    const moved = (await owner.ok<FloorView>("GET", "/v1/s/floor")).tables.find((t) => t.id === tables[0]!.id)!;
    expect([moved.posX, moved.posY]).toEqual([10, 20]);

    const report = await cashier.ok<DayReport>("GET", "/v1/s/reports/day");
    const paidBills = await unscopedDb.bill.findMany({ where: { status: "PAID" } });
    expect(report.bills.count).toBe(paidBills.length);
    expect(report.bills.total).toBe(paidBills.reduce((s, b) => s + b.total, 0));
    const received = await unscopedDb.payment.aggregate({ where: { status: "SUCCESS" }, _sum: { amount: true } });
    expect(report.payments.reduce((s, p) => s + p.amount, 0)).toBe(received._sum.amount);
    expect(report.taxLines.reduce((s, t) => s + t.amount, 0)).toBe(report.bills.taxTotal);
    expect(report.topItems[0]!.quantity).toBeGreaterThan(0);
    expect(report.orders.outOfStockItems + report.orders.cancelledItems).toBeGreaterThan(0);
    expect(report.open.sessions).toBe(live.length); // every seated test table ordered something
    expect((await waiter.req("GET", "/v1/s/reports/day")).statusCode).toBe(403);
  });
});
