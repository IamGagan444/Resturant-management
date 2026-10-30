import { db, type Hotel, type Prisma } from "@rms/db";
import type { BoardTable, KdsTicket, WaiterBoard } from "@rms/contracts";
import { businessDay } from "../lib/hotel";
import { orderInclude, requestInclude, toOrderItemView, toOrderView, toRequestView } from "./views";

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

/** Tables with their live session. `onlyTableIds` narrows to a waiter's tables. */
export async function boardTables(onlyTableIds?: string[]): Promise<BoardTable[]> {
  const tables = await db.table.findMany({
    where: { isActive: true, ...(onlyTableIds?.length ? { id: { in: onlyTableIds } } : {}) },
    include: {
      floor: { select: { name: true } },
      sessions: { where: { status: { in: ["OPEN", "BILLING"] } }, include: { _count: { select: { guests: true } } } },
    },
    orderBy: { label: "asc" },
  });
  return tables.map((t) => {
    const s = t.sessions[0];
    return {
      id: t.id,
      label: t.label,
      floor: t.floor?.name ?? null,
      status: t.status,
      session: s ? { id: s.id, joinCode: s.joinCode, isConfirmed: s.isConfirmed, guestCount: s._count.guests, openedAt: s.openedAt.toISOString() } : null,
    };
  });
}

/** Waiter's tables (assigned today; all tables if none are assigned to them) with everything needing action. */
export async function waiterBoard(hotel: Hotel, waiterId: string | null): Promise<WaiterBoard> {
  const mine = waiterId ? Object.entries(await assignmentsToday(hotel)).flatMap(([tableId, staff]) => (staff.includes(waiterId) ? [tableId] : [])) : [];
  const tables = await boardTables(mine);
  const sessionIds = tables.flatMap((t) => (t.session ? [t.session.id] : []));
  const [ready, pending, requests] = await Promise.all([
    db.orderItem.findMany({
      where: { status: { in: ["READY", "PICKED_UP", "OUT_OF_STOCK"] }, order: { sessionId: { in: sessionIds } } },
      include: { addons: true, order: { select: { sessionId: true, orderNumber: true } } },
      orderBy: { readyAt: "asc" },
    }),
    db.order.findMany({ where: { status: "PENDING_CONFIRMATION", sessionId: { in: sessionIds } }, include: orderInclude }),
    db.serviceRequest.findMany({ where: { status: { not: "DONE" }, sessionId: { in: sessionIds } }, include: requestInclude, orderBy: { createdAt: "asc" } }),
  ]);
  return {
    tables,
    ready: ready.map((i) => ({ ...toOrderItemView(i), sessionId: i.order.sessionId, orderNumber: i.order.orderNumber })),
    pendingOrders: pending.map(toOrderView),
    requests: requests.map(toRequestView),
  };
}
