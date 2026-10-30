import { db, nextCounter, type Hotel, type OrderSource, type OrderStatus, type Prisma } from "@rms/db";
import { rooms } from "@rms/contracts";
import { estimateEta } from "@rms/domain";
import { conflict, isUniqueViolation } from "../lib/errors";
import { businessDay } from "../lib/hotel";
import { emit } from "../realtime/io";
import { priceSelections } from "./menu";
import { waiterRooms } from "./notify";
import { orderInclude, type OrderWithItems } from "./views";

export interface NewLine {
  /** client-generated item id (offline / hub orders), so every copy agrees on it */
  id?: string;
  itemId: string;
  variantId?: string | null;
  addonIds: readonly string[];
  quantity: number;
  note?: string | null;
  guestId?: string | null;
  /** cart line id, echoed in errors so the UI can highlight it */
  ref?: string;
}

export interface CreateOrderParams {
  hotel: Hotel;
  sessionId: string;
  clientId: string;
  source: OrderSource;
  status: OrderStatus;
  lines: readonly NewLine[];
  note?: string | null;
  takenById?: string | null;
  /** checkout from the shared cart → empty it in the same transaction */
  clearCart?: boolean;
}

type ValidLine = Extract<Awaited<ReturnType<typeof priceSelections>>[number], { ok: true }>;

/** Snapshot of a priced line: name, price and tax as they are right now, so later menu edits never change the bill. */
export function orderItemData(hotelId: string, r: ValidLine, l: Pick<NewLine, "guestId" | "quantity" | "note">) {
  return {
    hotelId,
    itemId: r.item.id,
    guestId: l.guestId ?? null,
    stationId: r.item.stationId,
    nameSnapshot: r.item.name,
    variantName: r.line.variantName,
    unitPrice: r.line.unitPrice,
    quantity: l.quantity,
    taxBps: r.taxes.reduce((a, t) => a + t.rateBps, 0),
    taxSnapshot: r.taxes.map((t) => ({ name: t.name, rateBps: t.rateBps })),
    note: l.note ?? null,
    addons: { create: r.line.addons.map((a) => ({ hotelId, addonId: a.id, nameSnapshot: a.name, price: a.price })) },
  } satisfies Prisma.OrderItemUncheckedCreateWithoutOrderInput;
}

/**
 * Idempotent order creation. Same (hotel, clientId) always returns the same order,
 * whether the retry arrives after commit (lookup) or concurrently (unique violation → lookup).
 */
export async function createOrder(p: CreateOrderParams): Promise<{ order: OrderWithItems; created: boolean }> {
  const hotelId = p.hotel.id;
  const existing = await db.order.findUnique({ where: { hotelId_clientId: { hotelId, clientId: p.clientId } }, include: orderInclude });
  if (existing) return { order: existing, created: false };
  if (p.lines.length === 0) throw conflict("CART_EMPTY", "Add something to your order first");

  const priced = await priceSelections(p.hotel, p.lines);
  const invalid = priced.flatMap((r, i) => (r.ok ? [] : [{ ref: p.lines[i]?.ref ?? String(i), itemId: p.lines[i]?.itemId, errors: r.errors }]));
  if (invalid.length) throw conflict("ITEM_UNAVAILABLE", "Some items are no longer available", invalid);

  const queuedAhead = await db.orderItem.count({ where: { status: { in: ["QUEUED", "COOKING"] } } });
  const now = new Date();
  const { key, date } = businessDay(p.hotel, now);

  const items = p.lines.map((l, i) => {
    const r = priced[i];
    if (!r?.ok) throw new Error("unreachable: invalid line after validation");
    return { ...orderItemData(hotelId, r, l), ...(l.id ? { id: l.id } : {}) };
  });
  const prepTimes = priced.flatMap((r) => (r.ok ? [r.item.prepTimeMin] : []));

  try {
    const order = await db.$transaction(async (tx) => {
      const orderNumber = await nextCounter(tx, hotelId, `order:${key}`);
      const o = await tx.order.create({
        data: {
          hotelId,
          sessionId: p.sessionId,
          businessDate: date,
          orderNumber,
          source: p.source,
          status: p.status,
          clientId: p.clientId,
          note: p.note ?? null,
          takenById: p.takenById ?? null,
          etaAt: estimateEta(now, prepTimes, queuedAhead),
          items: { create: items },
        },
        include: orderInclude,
      });
      if (p.clearCart) await tx.cartItem.deleteMany({ where: { sessionId: p.sessionId } });
      await tx.tableSession.update({ where: { id: p.sessionId }, data: { lastActivityAt: now } });
      return o;
    });
    return { order, created: true };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const dup = await db.order.findUnique({ where: { hotelId_clientId: { hotelId, clientId: p.clientId } }, include: orderInclude });
    if (!dup) throw e;
    return { order: dup, created: false };
  }
}

/** Push a new/released order to everyone who must act on it. */
export async function announceOrder(order: OrderWithItems) {
  const hotelId = order.hotelId;
  const waiters = await waiterRooms(hotelId, order.session.tableId);
  if (order.status === "PENDING_CONFIRMATION") {
    emit("order:pending_confirmation", [...waiters, rooms.managers(hotelId), rooms.session(order.sessionId)], {
      hotelId,
      orderId: order.id,
      sessionId: order.sessionId,
      tableId: order.session.tableId,
      tableLabel: order.session.table.label,
    });
    return;
  }
  if (order.status !== "PLACED") return;
  const stationIds = [...new Set(order.items.map((i) => i.stationId).filter((s): s is string => Boolean(s)))];
  emit("order:placed", [rooms.kitchen(hotelId), rooms.managers(hotelId), rooms.session(order.sessionId), ...waiters], {
    hotelId,
    orderId: order.id,
    sessionId: order.sessionId,
    tableLabel: order.session.table.label,
    orderNumber: order.orderNumber,
    stationIds,
  });
}

/** Release held orders (waiter confirmed the table / payment succeeded). */
export async function releaseOrders(where: Prisma.OrderWhereInput, takenById: string | null) {
  const held = await db.order.findMany({ where, select: { id: true } });
  for (const { id } of held) {
    const r = await db.order.updateMany({
      where: { id, status: { in: ["PENDING_CONFIRMATION", "AWAITING_PAYMENT"] } },
      data: { status: "PLACED", ...(takenById ? { takenById } : {}) },
    });
    if (r.count === 0) continue;
    const order = await db.order.findUniqueOrThrow({ where: { id }, include: orderInclude });
    await announceOrder(order);
  }
}
