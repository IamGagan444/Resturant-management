import { db, type ItemStatus } from "@rms/db";
import { rooms, type ReplaceItemInput } from "@rms/contracts";
import { checkItemTransition, deriveOrderStatus, stampsFor, type Actor } from "@rms/domain";
import { AppError, conflict, notFound } from "../lib/errors";
import { audit } from "../lib/audit";
import { getHotel } from "../lib/hotel";
import { emit } from "../realtime/io";
import { cancelPickupEscalation, schedulePickupEscalation } from "../jobs/queue";
import { priceSelections } from "./menu";
import { waiterRooms } from "./notify";
import { orderItemData } from "./orders";

export interface TransitionActor {
  role: Actor;
  staffId: string | null;
}

export type TransitionOutcome = "APPLIED" | "NOOP";

const itemInclude = { order: { include: { session: { select: { id: true, tableId: true } } } } } as const;

/**
 * The single place item status changes. Forward-only + conditional update means:
 *  - stale offline replays are harmless NOOPs
 *  - two devices racing on the same item can't both win (updateMany WHERE status = from)
 */
export async function transitionItem(
  actor: TransitionActor,
  orderItemId: string,
  to: ItemStatus,
  reason?: string,
): Promise<TransitionOutcome> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = await db.orderItem.findUnique({ where: { id: orderItemId }, include: itemInclude });
    if (!item) throw notFound("Order item");
    const order = item.order;
    if ((order.status === "PENDING_CONFIRMATION" || order.status === "AWAITING_PAYMENT") && to !== "CANCELLED") {
      throw new AppError(409, "ORDER_NOT_RELEASED", "Order is waiting for confirmation or payment");
    }
    const check = checkItemTransition(item.status, to, actor.role);
    if (!check.ok) {
      if (check.reason === "NOOP") return "NOOP";
      if (check.reason === "FORBIDDEN") throw new AppError(403, "FORBIDDEN", `Your role can't move an item from ${item.status} to ${to}`);
      throw new AppError(409, "INVALID_TRANSITION", `Can't move an item from ${item.status} to ${to}`);
    }
    if (to === "CANCELLED" && item.status !== "OUT_OF_STOCK" && !reason) {
      throw new AppError(400, "REASON_REQUIRED", "Give a reason for cancelling");
    }

    const now = new Date();
    const applied = await db.$transaction(async (tx) => {
      const r = await tx.orderItem.updateMany({
        where: { id: item.id, status: item.status },
        data: {
          status: to,
          ...stampsFor(item.status, to, now, item),
          ...(to === "PICKED_UP" || (to === "SERVED" && !item.pickedUpById) ? { pickedUpById: actor.staffId } : {}),
          ...(to === "CANCELLED" ? { cancelReason: reason ?? "Removed by guest" } : {}),
        },
      });
      if (r.count === 0) return false; // lost a race; reload and re-evaluate
      const siblings = await tx.orderItem.findMany({ where: { orderId: order.id }, select: { status: true } });
      const next = deriveOrderStatus(order.status, siblings);
      if (next !== order.status) await tx.order.update({ where: { id: order.id }, data: { status: next } });
      if (to === "CANCELLED") await audit(actor.staffId, "ITEM_CANCELLED", "OrderItem", item.id, { reason: reason ?? null, from: item.status }, tx);
      if (to === "OUT_OF_STOCK") await audit(actor.staffId, "ITEM_OUT_OF_STOCK", "OrderItem", item.id, { menuItemId: item.itemId }, tx);
      return true;
    });
    if (!applied) continue;

    const hotel = await getHotel(item.hotelId);
    if (to === "READY") await schedulePickupEscalation(hotel.id, item.id, hotel.readyPickupAlertSec);
    else if (item.status === "READY") await cancelPickupEscalation(item.id);

    const sessionId = order.session.id;
    const waiters = await waiterRooms(hotel.id, order.session.tableId);
    emit(
      "item:status_changed",
      [rooms.kitchen(hotel.id), rooms.managers(hotel.id), rooms.session(sessionId), ...(to === "READY" || to === "OUT_OF_STOCK" ? waiters : [])],
      {
        hotelId: hotel.id,
        orderItemId: item.id,
        orderId: order.id,
        sessionId,
        stationId: item.stationId,
        from: item.status,
        to,
        updatedAt: now.toISOString(),
      },
    );
    if (to === "OUT_OF_STOCK") {
      emit("item:out_of_stock", [rooms.session(sessionId), ...waiters], {
        hotelId: hotel.id,
        orderItemId: item.id,
        orderId: order.id,
        sessionId,
        menuItemId: item.itemId,
      });
    }
    return "APPLIED";
  }
  throw new AppError(409, "CONCURRENT_UPDATE", "Item changed by someone else, refresh and retry");
}

/** KDS "Bump": everything still queued/cooking in this order (optionally one station) → READY. */
export async function bumpOrder(actor: TransitionActor, orderId: string, stationId: string | null): Promise<number> {
  const items = await db.orderItem.findMany({
    where: { orderId, status: { in: ["QUEUED", "COOKING"] }, ...(stationId ? { stationId } : {}) },
    select: { id: true },
  });
  let applied = 0;
  for (const i of items) if ((await transitionItem(actor, i.id, "READY")) === "APPLIED") applied++;
  return applied;
}

/**
 * Swap an OUT_OF_STOCK item for something else, in the same order (same ticket number for the kitchen).
 * Idempotent: the replacement chain is unique, so a retry returns the replacement already made.
 */
export async function replaceItem(actor: TransitionActor, orderItemId: string, input: ReplaceItemInput): Promise<string> {
  const old = await db.orderItem.findUnique({ where: { id: orderItemId }, include: { replacedBy: { select: { id: true } }, ...itemInclude } });
  if (!old) throw notFound("Order item");
  if (old.replacedBy) return old.replacedBy.id;
  if (old.status !== "OUT_OF_STOCK") throw conflict("NOT_OUT_OF_STOCK", "Only out-of-stock items can be swapped");
  const hotel = await getHotel(old.hotelId);
  const [priced] = await priceSelections(hotel, [{ itemId: input.itemId, variantId: input.variantId ?? null, addonIds: input.addonIds, quantity: old.quantity }]);
  if (!priced?.ok) throw new AppError(409, "ITEM_UNAVAILABLE", "That item can't be ordered right now", priced?.errors);

  const now = new Date();
  const created = await db.$transaction(async (tx) => {
    const r = await tx.orderItem.updateMany({
      where: { id: old.id, status: "OUT_OF_STOCK" },
      data: { status: "CANCELLED", cancelReason: "Replaced" },
    });
    if (r.count === 0) return null;
    const item = await tx.orderItem.create({
      data: { ...orderItemData(hotel.id, priced, { guestId: old.guestId, quantity: old.quantity, note: old.note }), orderId: old.orderId, replacesItemId: old.id },
    });
    const siblings = await tx.orderItem.findMany({ where: { orderId: old.orderId }, select: { status: true } });
    const next = deriveOrderStatus(old.order.status, siblings);
    if (next !== old.order.status) await tx.order.update({ where: { id: old.orderId }, data: { status: next } });
    await audit(actor.staffId, "ITEM_REPLACED", "OrderItem", old.id, { replacement: item.id, menuItemId: input.itemId }, tx);
    return item;
  });
  if (!created) {
    const again = await db.orderItem.findUnique({ where: { replacesItemId: old.id }, select: { id: true } });
    if (again) return again.id;
    throw conflict("CONCURRENT_UPDATE", "Item changed by someone else, refresh and retry");
  }

  const sessionId = old.order.session.id;
  const waiters = await waiterRooms(hotel.id, old.order.session.tableId);
  emit("item:status_changed", [rooms.kitchen(hotel.id), rooms.managers(hotel.id), rooms.session(sessionId), ...waiters], {
    hotelId: hotel.id,
    orderItemId: old.id,
    orderId: old.orderId,
    sessionId,
    stationId: old.stationId,
    from: "OUT_OF_STOCK",
    to: "CANCELLED",
    updatedAt: now.toISOString(),
  });
  // the replacement is new work for the kitchen: same ticket number, chimes like a new order
  const table = await db.table.findUniqueOrThrow({ where: { id: old.order.session.tableId }, select: { label: true } });
  emit("order:placed", [rooms.kitchen(hotel.id), rooms.managers(hotel.id), rooms.session(sessionId), ...waiters], {
    hotelId: hotel.id,
    orderId: old.orderId,
    sessionId,
    tableLabel: table.label,
    orderNumber: old.order.orderNumber,
    stationIds: created.stationId ? [created.stationId] : [],
  });
  return created.id;
}
