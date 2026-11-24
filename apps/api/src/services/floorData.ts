import { db, type Hotel, type Prisma } from "@rms/db";
import type { BoardTable, KdsTicket, WaiterBoard } from "@rms/contracts";
import { PAID_PARCEL_LIST_MS, PAID_PASS_MS } from "@rms/domain";
import { businessDay } from "../lib/hotel";
import { orderInclude, requestInclude, sessionLabel, toOrderItemView, toOrderView, toRequestView } from "./views";

const LIVE_ORDER = ["PLACED", "IN_PROGRESS", "READY"] as const;

/** Active kitchen tickets. stationId null = every station; items with no station show everywhere. */
export async function kdsTickets(stationId: string | null): Promise<KdsTicket[]> {
  return ticketsWhere({
    status: { in: ["QUEUED", "COOKING", "READY"] },
    ...(stationId ? { OR: [{ stationId }, { stationId: null }] } : {}),
  });
}

/** Every released order still in play (kitchen, pickup or a swap pending), all items. Used by the hub snapshot. */
export async function liveTickets(): Promise<KdsTicket[]> {
  return ticketsWhere({ status: { in: ["QUEUED", "COOKING", "READY", "PICKED_UP", "OUT_OF_STOCK"] } }, true);
}

/**
 * Kitchen tickets in three flat queries (matching item ids → their orders → their items) instead of one
 * nested relation filter; on a busy night this is several times faster and it's the most-polled screen.
 */
async function ticketsWhere(itemWhere: Prisma.OrderItemWhereInput, allItems = false): Promise<KdsTicket[]> {
  const hits = await db.orderItem.findMany({
    where: { ...itemWhere, order: { status: { in: [...LIVE_ORDER] } } },
    select: { orderId: true },
    distinct: ["orderId"],
  });
  if (hits.length === 0) return [];
  const orderIds = hits.map((h) => h.orderId);
  const [orders, items] = await Promise.all([
    db.order.findMany({ where: { id: { in: orderIds } }, include: { session: orderInclude.session }, orderBy: { placedAt: "asc" }, take: 300 }),
    db.orderItem.findMany({
      where: { orderId: { in: orderIds }, ...(allItems ? {} : itemWhere) },
      include: { addons: true, item: { select: { prepTimeMin: true } } },
      orderBy: { id: "asc" },
    }),
  ]);
  const byOrder = new Map<string, typeof items>();
  for (const i of items) {
    const list = byOrder.get(i.orderId) ?? [];
    list.push(i);
    byOrder.set(i.orderId, list);
  }
  return orders.map((o) => {
    const its = byOrder.get(o.id) ?? [];
    return {
      ...toOrderView({ ...o, items: its }),
      items: its.map((i) => ({ ...toOrderItemView(i), prepTimeMin: i.item.prepTimeMin })),
    };
  });
}

/** Today's table → staff assignments. */
export async function assignmentsToday(hotel: Hotel): Promise<Record<string, string[]>> {
  const { date } = businessDay(hotel);
  const rows = await db.tableAssignment.findMany({ where: { shiftDate: date }, select: { tableId: true, staffId: true } });
  const map: Record<string, string[]> = {};
  for (const r of rows) (map[r.tableId] ??= []).push(r.staffId);
  return map;
}

/** Tables with their live session (a parcel counter: its open tokens). */
export async function boardTables(): Promise<BoardTable[]> {
  const tables = await db.table.findMany({
    where: { isActive: true },
    include: {
      floor: { select: { name: true } },
      sessions: { where: { status: { in: ["OPEN", "BILLING"] } }, include: { _count: { select: { guests: true } } }, orderBy: { openedAt: "asc" } },
    },
    orderBy: { label: "asc" },
  });
  return tables.map((t) => {
    const s = t.isParcelCounter ? undefined : t.sessions[0];
    return {
      id: t.id,
      label: t.label,
      floor: t.floor?.name ?? null,
      status: t.status,
      isParcelCounter: t.isParcelCounter,
      parcels: t.isParcelCounter ? t.sessions.map((x) => sessionLabel({ ...x, table: t })) : [],
      session: s ? { id: s.id, joinCode: s.joinCode, isConfirmed: s.isConfirmed, guestCount: s._count.guests, openedAt: s.openedAt.toISOString() } : null,
    };
  });
}

/** Table still open, or paid before this dish was carried out (not one eaten long ago that nobody tapped "Served" on). */
function stillToServe(i: { status: string; readyAt: Date | null; pickedUpAt: Date | null }, closedAt: Date | null): boolean {
  if (!closedAt) return true;
  if (i.status === "PICKED_UP") return i.pickedUpAt !== null && i.pickedUpAt > closedAt;
  return i.readyAt !== null && i.readyAt.getTime() > closedAt.getTime() - PAID_PASS_MS;
}

/** Waiter's tables (assigned today; all tables if none are assigned to them) with everything needing action. */
export async function waiterBoard(hotel: Hotel, waiterId: string | null): Promise<WaiterBoard> {
  const assigned = waiterId ? await assignmentsToday(hotel) : {};
  const mine = waiterId ? Object.keys(assigned).filter((tableId) => assigned[tableId]?.includes(waiterId)) : [];
  // a parcel counter nobody is assigned to belongs to every waiter (they all get its alerts)
  const tables = (await boardTables()).filter((t) => !mine.length || mine.includes(t.id) || (t.isParcelCounter && !assigned[t.id]?.length));
  const tableId = { in: tables.map((t) => t.id) };
  const recent = new Date(Date.now() - PAID_PARCEL_LIST_MS);
  const live = { tableId, status: { in: ["OPEN" as const, "BILLING" as const] } };
  const [ready, pending, requests] = await Promise.all([
    db.orderItem.findMany({
      where: {
        status: { in: ["READY", "PICKED_UP", "OUT_OF_STOCK"] },
        OR: [
          { order: { session: live } },
          // parcels are often paid for before they're ready: paying must not take them off the list
          { isParcel: true, order: { session: { tableId, status: "CLOSED" }, placedAt: { gt: recent } } },
          // guests who paid before their food came, until the table is cleared for the next ones
          { status: { in: ["READY", "PICKED_UP"] }, order: { session: { status: "CLOSED", tableId, table: { status: "CLEANING" } }, placedAt: { gt: recent } } },
        ],
      },
      include: { addons: true, order: { select: { sessionId: true, orderNumber: true, session: { select: { tableId: true, status: true, closedAt: true, parcelNo: true, table: { select: { label: true } } } } } } },
      orderBy: { readyAt: "asc" },
    }),
    db.order.findMany({ where: { status: "PENDING_CONFIRMATION", session: live }, include: orderInclude }),
    db.serviceRequest.findMany({ where: { status: { not: "DONE" }, session: live }, include: requestInclude, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    tables,
    ready: ready.filter((i) => i.isParcel || stillToServe(i, i.order.session.closedAt)).map((i) => ({
      ...toOrderItemView(i),
      sessionId: i.order.sessionId,
      orderNumber: i.order.orderNumber,
      tableId: i.order.session.tableId,
      tableLabel: sessionLabel(i.order.session),
      unpaid: i.order.session.parcelNo !== null && i.order.session.status !== "CLOSED",
    })),
    pendingOrders: pending.map(toOrderView),
    requests: requests.map(toRequestView),
  };
}
