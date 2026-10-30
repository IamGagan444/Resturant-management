import { createHmac } from "node:crypto";
import { db, nextCounter, type Hotel, type Prisma, type Tx } from "@rms/db";
import { rooms, type BillView, type SplitBillInput } from "@rms/contracts";
import { computeBill, fiscalYearLabel, formatBillNumber, splitEqual, splitProportional, type BillOptions, type TaxRate } from "@rms/domain";
import { env } from "../env";
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from "../lib/errors";
import { safeEqual } from "../lib/crypto";
import { getHotel } from "../lib/hotel";
import { emit } from "../realtime/io";
import { releaseOrders } from "./orders";
import { waiterRooms } from "./notify";

const billInclude = { taxLines: true, splits: { orderBy: { label: "asc" } } } satisfies Prisma.BillInclude;
type BillRow = Prisma.BillGetPayload<{ include: typeof billInclude }>;

/** A guest's UPI attempt holds the bill for this long, so two phones can't both pay the full amount. */
export const PAYMENT_LOCK_MS = 5 * 60_000;

function taxesOf(snapshot: Prisma.JsonValue | null): TaxRate[] {
  if (!Array.isArray(snapshot)) return [];
  return snapshot.flatMap((t) =>
    t && typeof t === "object" && !Array.isArray(t) && typeof t.name === "string" && typeof t.rateBps === "number"
      ? [{ name: t.name, rateBps: t.rateBps }]
      : [],
  );
}

const itemInclude = { addons: true, guest: { select: { displayName: true } } } satisfies Prisma.OrderItemInclude;
type BillItem = Prisma.OrderItemGetPayload<{ include: typeof itemInclude }>;

const RELEASED = ["PLACED", "IN_PROGRESS", "READY", "SERVED"] as const;

/** Items that belong on the bill: released orders, not cancelled / out of stock. `extraOrderId` adds a held pay-now order. */
async function billableItems(sessionId: string, extraOrderId?: string): Promise<BillItem[]> {
  const released: Prisma.OrderWhereInput = { sessionId, status: { in: [...RELEASED] } };
  return db.orderItem.findMany({
    where: {
      order: extraOrderId ? { OR: [released, { id: extraOrderId, sessionId }] } : released,
      status: { notIn: ["CANCELLED", "OUT_OF_STOCK"] },
    },
    include: itemInclude,
    orderBy: { id: "asc" },
  });
}

function optionsFor(bill: { pricesIncludeTax: boolean; discount: number; serviceChargeBps: number } | null, hotel: Hotel): BillOptions {
  return {
    pricesIncludeTax: bill?.pricesIncludeTax ?? hotel.pricesIncludeTax,
    discount: bill?.discount ?? 0,
    serviceChargeBps: bill?.serviceChargeBps ?? hotel.serviceChargeBps,
  };
}

const totalsOf = (items: readonly BillItem[], opts: BillOptions) =>
  computeBill(
    items.map((i) => ({ amount: i.unitPrice * i.quantity, taxes: taxesOf(i.taxSnapshot) })),
    opts,
  );

const currentBill = (sessionId: string) => db.bill.findFirst({ where: { sessionId, status: { not: "VOID" } }, include: billInclude });

/**
 * Splits are payment targets carved out of what was due when the bill was split.
 * When the total changes afterwards, unpaid splits no longer add up: drop them and keep one "Remaining" split.
 */
async function resetSplits(tx: Tx, bill: BillRow, total: number) {
  if (bill.splits.length === 0) return;
  const paidSplits = bill.splits.filter((s) => s.isPaid);
  await tx.billSplit.deleteMany({ where: { billId: bill.id, isPaid: false } });
  const settled = await tx.payment.aggregate({ where: { sessionId: bill.sessionId, status: "SUCCESS" }, _sum: { amount: true } });
  const remaining = total - (settled._sum.amount ?? 0);
  if (paidSplits.length === 0) {
    await tx.bill.update({ where: { id: bill.id }, data: { splitType: "NONE" } });
  } else if (remaining > 0) {
    await tx.billSplit.create({ data: { hotelId: bill.hotelId, billId: bill.id, label: "Remaining", amount: remaining } });
  }
}

/**
 * Recompute the live bill from the session's orders and persist it.
 * A PAID bill is frozen. Discount / service-charge choices made by the cashier are kept across recomputes.
 */
export async function syncBill(sessionId: string): Promise<{ bill: BillRow; items: BillItem[] }> {
  const session = await db.tableSession.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound("Session");
  const hotel = await getHotel(session.hotelId);
  const items = await billableItems(sessionId);
  let bill = await currentBill(sessionId);
  if (bill?.status === "PAID") return { bill, items };

  const opts = optionsFor(bill, hotel);
  const t = totalsOf(items, opts);
  const fields = {
    subtotal: t.subtotal,
    discount: t.discount,
    serviceCharge: t.serviceCharge,
    serviceChargeBps: opts.serviceChargeBps,
    taxTotal: t.taxTotal,
    roundOff: t.roundOff,
    total: t.total,
    pricesIncludeTax: opts.pricesIncludeTax,
  };
  const unchanged =
    bill &&
    bill.subtotal === fields.subtotal &&
    bill.discount === fields.discount &&
    bill.serviceCharge === fields.serviceCharge &&
    bill.taxTotal === fields.taxTotal &&
    bill.total === fields.total;
  if (unchanged && bill) return { bill, items };

  const taxLines = t.taxLines.map((l) => ({ hotelId: hotel.id, ...l }));
  const prev = bill;
  try {
    bill = await db.$transaction(async (tx) => {
      const b = prev
        ? await tx.bill.update({ where: { id: prev.id }, data: fields })
        : await tx.bill.create({ data: { hotelId: hotel.id, sessionId, ...fields } });
      await tx.billTaxLine.deleteMany({ where: { billId: b.id } });
      await tx.billTaxLine.createMany({ data: taxLines.map((l) => ({ ...l, billId: b.id })) });
      if (prev && prev.total !== fields.total) await resetSplits(tx, prev, fields.total);
      return tx.bill.findUniqueOrThrow({ where: { id: b.id }, include: billInclude });
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e; // concurrent first view created it; use theirs
    bill = await db.bill.findFirstOrThrow({ where: { sessionId, status: { not: "VOID" } }, include: billInclude });
  }
  return { bill, items };
}

/** UPI attempts still holding the session (PENDING, started within PAYMENT_LOCK_MS). */
function inFlight(sessionId: string, client: Tx = db) {
  return client.payment.findMany({
    where: { sessionId, method: "UPI", status: "PENDING", createdAt: { gt: new Date(Date.now() - PAYMENT_LOCK_MS) } },
    select: { id: true, clientId: true, splitId: true, orderId: true },
  });
}

export async function paidForSession(sessionId: string): Promise<number> {
  const agg = await db.payment.aggregate({ where: { sessionId, status: "SUCCESS" }, _sum: { amount: true } });
  return agg._sum.amount ?? 0;
}

async function paidBySplit(billId: string): Promise<Map<string, number>> {
  const rows = await db.payment.groupBy({ by: ["splitId"], where: { billId, status: "SUCCESS", splitId: { not: null } }, _sum: { amount: true } });
  return new Map(rows.flatMap((r) => (r.splitId ? [[r.splitId, r._sum.amount ?? 0] as const] : [])));
}

// ── Digital receipt links ─────────────────────
const receiptSig = (billId: string) => createHmac("sha256", env.ENCRYPTION_KEY).update(`receipt:${billId}`).digest("base64url").slice(0, 22);
export const receiptToken = (billId: string) => `${billId}.${receiptSig(billId)}`;
export const receiptUrl = (billId: string) => `${env.CUSTOMER_URL}/r/${receiptToken(billId)}`;

/** Returns the bill id if the token is genuine. */
export function verifyReceiptToken(token: string): string | null {
  const [billId, sig] = token.split(".");
  if (!billId || !sig) return null;
  return safeEqual(receiptSig(billId), sig) ? billId : null;
}

export async function billView(sessionId: string): Promise<BillView> {
  const { bill, items } = await syncBill(sessionId);
  const [paid, session, splitPaid, pending] = await Promise.all([
    paidForSession(sessionId),
    db.tableSession.findUniqueOrThrow({ where: { id: sessionId }, select: { table: { select: { label: true } } } }),
    paidBySplit(bill.id),
    inFlight(sessionId),
  ]);
  return {
    id: bill.id,
    sessionId,
    tableLabel: session.table.label,
    billNumber: bill.billNumber,
    lines: items.map((i) => ({
      orderItemId: i.id,
      name: i.nameSnapshot,
      variantName: i.variantName,
      addons: i.addons.map((a) => a.nameSnapshot),
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      amount: i.unitPrice * i.quantity,
      guestId: i.guestId,
      guestName: i.guest?.displayName ?? null,
      splitId: i.billSplitId,
    })),
    subtotal: bill.subtotal,
    discount: bill.discount,
    serviceCharge: bill.serviceCharge,
    serviceChargeBps: bill.serviceChargeBps,
    taxTotal: bill.taxTotal,
    roundOff: bill.roundOff,
    total: bill.total,
    paid,
    due: Math.max(0, bill.total - paid),
    pricesIncludeTax: bill.pricesIncludeTax,
    splitType: bill.splitType,
    status: bill.status,
    taxLines: bill.taxLines.map((l) => ({ name: l.name, rateBps: l.rateBps, taxable: l.taxable, amount: l.amount })),
    splits: bill.splits.map((s) => ({ id: s.id, label: s.label, amount: s.amount, paid: splitPaid.get(s.id) ?? 0, isPaid: s.isPaid })),
    paymentInFlight: pending.length > 0,
    receiptUrl: bill.status === "PAID" ? receiptUrl(bill.id) : null,
  };
}

/** Bill must be live (not PAID / VOID) to take adjustments or payments. */
export async function liveBill(billId: string) {
  const bill = await db.bill.findUnique({ where: { id: billId } });
  if (!bill) throw notFound("Bill");
  if (bill.status === "PAID" || bill.status === "VOID") throw new AppError(409, "BILL_CLOSED", "This bill is already closed");
  return bill;
}

export function announceBill(hotelId: string, billId: string, sessionId: string) {
  emit("bill:updated", [rooms.session(sessionId), rooms.cashiers(hotelId), rooms.managers(hotelId)], { hotelId, billId, sessionId });
}

// ── Splits ────────────────────────────────────
/**
 * Split what is still due. EQUAL: n near-equal parts. BY_GUEST / BY_ITEM: pro-rata to menu value,
 * so discount, service charge, tax and round-off are shared consistently. NONE removes the split.
 * Not allowed once a split is paid or while a guest is mid-payment.
 */
export async function splitBill(billId: string, input: SplitBillInput): Promise<string> {
  const live = await liveBill(billId);
  const view = await billView(live.sessionId);
  if (view.splits.some((s) => s.isPaid || s.paid > 0)) throw conflict("SPLIT_LOCKED", "Part of this split is already paid");
  if (view.paymentInFlight) throw conflict("PAYMENT_IN_PROGRESS", "Someone is paying right now. Try again in a moment.");

  let parts: { label: string; amount: number; itemIds: string[] }[] = [];
  if (input.type !== "NONE" && view.due <= 0) throw conflict("NOTHING_DUE", "Nothing left to split");
  if (input.type === "EQUAL") {
    parts = splitEqual(view.due, input.parts).map((amount, i) => ({ label: `Part ${i + 1} of ${input.parts}`, amount, itemIds: [] }));
  } else if (input.type === "BY_GUEST" || input.type === "BY_ITEM") {
    let groups: { label: string; itemIds: string[] }[];
    if (input.type === "BY_GUEST") {
      const byGuest = new Map<string, { label: string; itemIds: string[] }>();
      for (const l of view.lines) {
        const key = l.guestId ?? "shared";
        const g = byGuest.get(key) ?? { label: l.guestName ?? "Shared", itemIds: [] };
        g.itemIds.push(l.orderItemId);
        byGuest.set(key, g);
      }
      groups = [...byGuest.values()];
      if (groups.length < 2) throw conflict("ONE_GUEST", "Everything was ordered by one person. Split equally instead.");
    } else {
      groups = input.groups.map((g) => ({ label: g.label.trim() || "Group", itemIds: [...new Set(g.orderItemIds)] }));
      const all = groups.flatMap((g) => g.itemIds);
      const onBill = new Set(view.lines.map((l) => l.orderItemId));
      if (new Set(all).size !== all.length) throw badRequest("ITEM_TWICE", "An item is in more than one group");
      if (all.length !== onBill.size || all.some((id) => !onBill.has(id))) {
        throw badRequest("ITEMS_MISMATCH", "Put every item on the bill in exactly one group");
      }
    }
    const amountOf = new Map(view.lines.map((l) => [l.orderItemId, l.amount]));
    const values = groups.map((g) => g.itemIds.reduce((a, id) => a + (amountOf.get(id) ?? 0), 0));
    const amounts = splitProportional(view.due, values);
    parts = groups.map((g, i) => ({ label: g.label, amount: amounts[i] ?? 0, itemIds: g.itemIds }));
  }

  await db.$transaction(async (tx) => {
    await tx.orderItem.updateMany({ where: { billSplit: { billId } }, data: { billSplitId: null } });
    await tx.billSplit.deleteMany({ where: { billId } });
    for (const p of parts) {
      const s = await tx.billSplit.create({ data: { hotelId: live.hotelId, billId, label: p.label.slice(0, 40), amount: p.amount } });
      if (p.itemIds.length) await tx.orderItem.updateMany({ where: { id: { in: p.itemIds } }, data: { billSplitId: s.id } });
    }
    await tx.bill.update({ where: { id: billId }, data: { splitType: input.type } });
  });
  announceBill(live.hotelId, billId, live.sessionId);
  return live.sessionId;
}

// ── UPI payment reservation (the per-bill lock) ─
export type UpiTarget = { kind: "ORDER"; orderId: string } | { kind: "BILL"; billId: string; splitId?: string };

/** What a pay-now order adds to the bill: total with the order − what's already paid. Never drifts by rounding. */
async function payNowAmount(sessionId: string, orderId: string, hotel: Hotel): Promise<number> {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order || order.sessionId !== sessionId) throw notFound("Order");
  if (order.status !== "AWAITING_PAYMENT") throw conflict("ALREADY_PAID", "This order is already paid");
  const [items, bill, paid] = await Promise.all([billableItems(sessionId, orderId), currentBill(sessionId), paidForSession(sessionId)]);
  return Math.max(0, totalsOf(items, optionsFor(bill, hotel)).total - paid);
}

/**
 * Create the PENDING payment for a UPI attempt, or refuse if it could double-charge:
 *  - paying the whole bill or a pay-now order clashes with any other attempt in flight at the table
 *  - paying a split clashes with whole-bill attempts and with the same split
 * Serialised per session with a row lock, so two phones tapping Pay together can't both get through.
 */
export async function reserveUpiPayment(p: { hotel: Hotel; sessionId: string; clientId: string; target: UpiTarget }) {
  const { hotel, sessionId, target } = p;
  let amount: number;
  let billId: string | null = null;
  let splitId: string | null = null;
  let orderId: string | null = null;
  if (target.kind === "ORDER") {
    orderId = target.orderId;
    amount = await payNowAmount(sessionId, orderId, hotel);
  } else {
    const view = await billView(sessionId);
    if (view.id !== target.billId) throw notFound("Bill");
    if (view.status === "PAID" || view.due <= 0) throw conflict("NOTHING_DUE", "This bill is already paid");
    billId = view.id;
    if (target.splitId) {
      const split = view.splits.find((s) => s.id === target.splitId);
      if (!split) throw notFound("Split");
      if (split.isPaid) throw conflict("NOTHING_DUE", "This part is already paid");
      splitId = split.id;
      amount = Math.min(split.amount - split.paid, view.due);
    } else {
      if (view.splits.some((s) => !s.isPaid)) throw conflict("BILL_SPLIT", "This bill is split. Pay your part.");
      amount = view.due;
    }
  }
  if (amount <= 0) throw conflict("NOTHING_DUE", "Nothing to pay");

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "TableSession" WHERE id = ${sessionId} FOR UPDATE`;
    const others = (await inFlight(sessionId, tx)).filter((x) => x.clientId !== p.clientId);
    if (others.some((x) => !splitId || !x.splitId || x.splitId === splitId)) {
      throw conflict("PAYMENT_IN_PROGRESS", "Someone at your table is paying right now. Wait a moment, then check the bill.");
    }
    return tx.payment.create({
      data: { hotelId: hotel.id, sessionId, billId, splitId, orderId, clientId: p.clientId, method: "UPI", amount, status: "PENDING" },
    });
  });
}

// ── Settlement ────────────────────────────────
/**
 * If the session is fully paid: freeze the bill with a GST invoice number, close the session,
 * send the table to CLEANING. Safe to call repeatedly / concurrently (conditional update).
 */
export async function settleIfPaid(sessionId: string): Promise<boolean> {
  const view = await billView(sessionId);
  if (view.status === "PAID") return false;
  if (view.paid === 0 || view.paid < view.total) {
    if (view.paid > 0 && view.status === "OPEN") await db.bill.update({ where: { id: view.id }, data: { status: "PARTIALLY_PAID" } });
    return false;
  }
  const session = await db.tableSession.findUniqueOrThrow({ where: { id: sessionId } });
  const hotel = await getHotel(session.hotelId);
  const now = new Date();
  const fy = fiscalYearLabel(now, hotel.timezone);

  const settled = await db
    .$transaction(async (tx) => {
      const seq = await nextCounter(tx, hotel.id, `bill:${fy}`);
      const r = await tx.bill.updateMany({
        where: { id: view.id, status: { in: ["OPEN", "PARTIALLY_PAID"] } },
        data: { status: "PAID", billNumber: formatBillNumber(hotel.invoicePrefix, fy, seq), finalizedAt: now, closedAt: now },
      });
      if (r.count === 0) throw new SettledElsewhere(); // roll back the counter increment too
      await tx.payment.updateMany({ where: { sessionId, billId: null }, data: { billId: view.id } });
      await tx.billSplit.updateMany({ where: { billId: view.id }, data: { isPaid: true } });
      await tx.tableSession.update({ where: { id: sessionId }, data: { status: "CLOSED", closedAt: now } });
      await tx.table.update({ where: { id: session.tableId }, data: { status: "CLEANING" } });
      await tx.serviceRequest.updateMany({ where: { sessionId, status: { not: "DONE" } }, data: { status: "DONE", doneAt: now } });
      await tx.cartItem.deleteMany({ where: { sessionId } });
      // pay-now orders abandoned before payment can't be paid once the table is closed
      await tx.orderItem.updateMany({
        where: { order: { sessionId, status: "AWAITING_PAYMENT" } },
        data: { status: "CANCELLED", cancelReason: "Payment not completed" },
      });
      await tx.order.updateMany({ where: { sessionId, status: "AWAITING_PAYMENT" }, data: { status: "CANCELLED" } });
      return true;
    })
    .catch((e: unknown) => {
      if (e instanceof SettledElsewhere) return false;
      throw e;
    });
  if (!settled) return false;

  const waiters = await waiterRooms(hotel.id, session.tableId);
  const to = [rooms.session(sessionId), rooms.cashiers(hotel.id), rooms.managers(hotel.id), ...waiters];
  emit("bill:paid", to, { hotelId: hotel.id, billId: view.id, sessionId, receiptUrl: receiptUrl(view.id) });
  emit("table:status_changed", [rooms.managers(hotel.id), ...waiters], { hotelId: hotel.id, tableId: session.tableId, status: "CLEANING" });
  return true;
}

class SettledElsewhere extends Error {}

/** A split is paid once its successful payments cover it. */
async function refreshSplit(splitId: string) {
  const [split, agg] = await Promise.all([
    db.billSplit.findUnique({ where: { id: splitId } }),
    db.payment.aggregate({ where: { splitId, status: "SUCCESS" }, _sum: { amount: true } }),
  ]);
  if (split && !split.isPaid && (agg._sum.amount ?? 0) >= split.amount) {
    await db.billSplit.update({ where: { id: splitId }, data: { isPaid: true } });
  }
}

/** Book-keeping after any successful payment: splits, pay-now release, settlement, live updates. */
export async function afterPayment(payment: { sessionId: string; splitId: string | null; orderId: string | null; hotelId: string }) {
  if (payment.splitId) await refreshSplit(payment.splitId);
  if (payment.orderId) {
    // Pay-now: the order goes to the kitchen. Guests are still eating, so only settle if they already asked for the bill.
    await releaseOrders({ id: payment.orderId, status: "AWAITING_PAYMENT" }, null);
    const s = await db.tableSession.findUnique({ where: { id: payment.sessionId }, select: { status: true } });
    if (s?.status === "BILLING") await settleIfPaid(payment.sessionId);
  } else {
    await settleIfPaid(payment.sessionId);
  }
  const view = await billView(payment.sessionId);
  announceBill(payment.hotelId, view.id, payment.sessionId);
}

/**
 * → SUCCESS exactly once (checkout callback and webhook may both arrive).
 * Callers have verified the gateway signature and amount. An attempt the guest dismissed (FAILED)
 * can still be captured by the bank later; that money is real, so it is recorded too.
 */
export async function markPaymentSuccess(paymentId: string, gatewayRef: string | null): Promise<void> {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw notFound("Payment");
  const r = await db.payment.updateMany({
    where: { id: p.id, OR: [{ status: "PENDING" }, { status: "FAILED", gatewayRef: null }] }, // never revive an amount-mismatch failure
    data: { status: "SUCCESS", gatewayRef },
  });
  if (r.count > 0) await afterPayment(p);
}
