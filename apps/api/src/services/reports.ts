import { db, type Hotel } from "@rms/db";
import type { DayReport, FloorView } from "@rms/contracts";
import { businessDayRange } from "@rms/domain";
import { billView } from "./billing";

/**
 * End-of-day summary for one business date.
 * Sales = bills settled in the business-day window (GST invoices); payments = money received in the window,
 * which is what the cash drawer should match. Item counts come from that day's orders.
 */
export async function dayReport(hotel: Hotel, date: string): Promise<DayReport> {
  const { from, to } = businessDayRange(date, hotel.timezone, hotel.dayStartsAt);
  const businessDate = new Date(`${date}T00:00:00Z`);
  const closedIn = { status: "PAID" as const, closedAt: { gte: from, lt: to } };

  const [bills, taxLines, payments, orders, itemStatus, top, openSessions] = await Promise.all([
    db.bill.aggregate({
      where: closedIn,
      _count: true,
      _sum: { subtotal: true, discount: true, serviceCharge: true, taxTotal: true, roundOff: true, total: true },
    }),
    db.billTaxLine.groupBy({ by: ["name", "rateBps"], where: { bill: closedIn }, _sum: { taxable: true, amount: true }, orderBy: [{ name: "asc" }, { rateBps: "asc" }] }),
    db.payment.groupBy({ by: ["method"], where: { status: "SUCCESS", createdAt: { gte: from, lt: to } }, _count: true, _sum: { amount: true } }),
    db.order.groupBy({ by: ["source"], where: { businessDate, status: { not: "CANCELLED" } }, _count: true }),
    db.orderItem.groupBy({ by: ["status"], where: { order: { businessDate }, status: { in: ["CANCELLED", "OUT_OF_STOCK"] } }, _count: true }),
    db.orderItem.groupBy({
      by: ["nameSnapshot"],
      where: { order: { businessDate, status: { notIn: ["CANCELLED", "AWAITING_PAYMENT"] } }, status: { notIn: ["CANCELLED", "OUT_OF_STOCK"] } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),
    db.tableSession.findMany({ where: { status: { in: ["OPEN", "BILLING"] }, orders: { some: {} } }, select: { id: true } }),
  ]);

  // Amount per top item needs unitPrice × quantity, which groupBy can't multiply.
  const topNames = top.map((t) => t.nameSnapshot);
  const topRows = topNames.length
    ? await db.orderItem.findMany({
        where: { nameSnapshot: { in: topNames }, order: { businessDate, status: { notIn: ["CANCELLED", "AWAITING_PAYMENT"] } }, status: { notIn: ["CANCELLED", "OUT_OF_STOCK"] } },
        select: { nameSnapshot: true, unitPrice: true, quantity: true },
      })
    : [];
  const amountByName = new Map<string, number>();
  for (const r of topRows) amountByName.set(r.nameSnapshot, (amountByName.get(r.nameSnapshot) ?? 0) + r.unitPrice * r.quantity);

  const discounted = await db.bill.findMany({ where: { ...closedIn, discount: { gt: 0 } }, select: { id: true, billNumber: true, discount: true }, orderBy: { closedAt: "asc" } });
  const reasons = discounted.length
    ? await db.auditLog.findMany({
        where: { action: "DISCOUNT_APPLIED", entity: "Bill", entityId: { in: discounted.map((b) => b.id) } },
        orderBy: { createdAt: "asc" },
        select: { entityId: true, meta: true },
      })
    : [];
  const reasonOf = new Map<string, string | null>();
  for (const r of reasons) {
    const meta = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? r.meta : {};
    reasonOf.set(r.entityId, typeof meta.reason === "string" ? meta.reason : null); // latest wins
  }

  const openViews = await Promise.all(openSessions.map((s) => billView(s.id)));
  const count = bills._count;
  const total = bills._sum.total ?? 0;
  const orderCount = (src: string) => orders.find((o) => o.source === src)?._count ?? 0;
  return {
    date,
    from: from.toISOString(),
    to: to.toISOString(),
    bills: {
      count,
      subtotal: bills._sum.subtotal ?? 0,
      discount: bills._sum.discount ?? 0,
      serviceCharge: bills._sum.serviceCharge ?? 0,
      taxTotal: bills._sum.taxTotal ?? 0,
      roundOff: bills._sum.roundOff ?? 0,
      total,
      averageBill: count ? Math.round(total / count) : 0,
    },
    taxLines: taxLines.map((t) => ({ name: t.name, rateBps: t.rateBps, taxable: t._sum.taxable ?? 0, amount: t._sum.amount ?? 0 })),
    payments: payments.map((p) => ({ method: p.method, count: p._count, amount: p._sum.amount ?? 0 })),
    orders: {
      count: orders.reduce((a, o) => a + o._count, 0),
      qr: orderCount("QR_CUSTOMER"),
      waiter: orderCount("WAITER"),
      cancelledItems: itemStatus.find((s) => s.status === "CANCELLED")?._count ?? 0,
      outOfStockItems: itemStatus.find((s) => s.status === "OUT_OF_STOCK")?._count ?? 0,
    },
    topItems: top.map((t) => ({ name: t.nameSnapshot, quantity: t._sum.quantity ?? 0, amount: amountByName.get(t.nameSnapshot) ?? 0 })),
    discounts: discounted.map((b) => ({ billNumber: b.billNumber, amount: b.discount, reason: reasonOf.get(b.id) ?? null })),
    open: { sessions: openViews.length, due: openViews.reduce((a, v) => a + v.due, 0) },
  };
}

/** Manager's live floor: every table with what's happening at it, plus overdue pickups. */
export async function floorView(hotel: Hotel): Promise<FloorView> {
  const [floors, tables] = await Promise.all([
    db.floor.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.table.findMany({
      where: { isActive: true },
      include: { sessions: { where: { status: { in: ["OPEN", "BILLING"] } }, include: { _count: { select: { guests: true } } } } },
      orderBy: { label: "asc" },
    }),
  ]);
  const sessionIds = tables.flatMap((t) => t.sessions.map((s) => s.id));
  const [items, requests, pending, bills] = await Promise.all([
    db.orderItem.findMany({
      where: { status: { in: ["QUEUED", "COOKING", "READY"] }, order: { sessionId: { in: sessionIds }, status: { in: ["PLACED", "IN_PROGRESS", "READY"] } } },
      select: { id: true, status: true, nameSnapshot: true, readyAt: true, order: { select: { sessionId: true } } },
    }),
    db.serviceRequest.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, status: { not: "DONE" } }, _count: true }),
    db.order.findMany({ where: { sessionId: { in: sessionIds }, status: "PENDING_CONFIRMATION" }, select: { sessionId: true } }),
    Promise.all(sessionIds.map((id) => billView(id))), // recomputes, so totals include orders nobody has billed yet
  ]);
  const count = (sid: string, st: string) => items.filter((i) => i.order.sessionId === sid && i.status === st).length;
  const now = Date.now();
  const labelOf = new Map(tables.flatMap((t) => t.sessions.map((s) => [s.id, t.label] as const)));

  return {
    floors,
    tables: tables.map((t) => {
      const s = t.sessions[0];
      const bill = s ? bills.find((b) => b.sessionId === s.id) : undefined;
      return {
        id: t.id,
        label: t.label,
        floorId: t.floorId,
        seats: t.seats,
        posX: t.posX,
        posY: t.posY,
        status: t.status,
        session: s
          ? {
              id: s.id,
              guestCount: s._count.guests,
              openedAt: s.openedAt.toISOString(),
              total: bill?.total ?? 0,
              due: bill?.due ?? 0,
              cooking: count(s.id, "QUEUED") + count(s.id, "COOKING"),
              ready: count(s.id, "READY"),
              openRequests: requests.find((r) => r.sessionId === s.id)?._count ?? 0,
              pendingConfirm: pending.some((p) => p.sessionId === s.id),
            }
          : null,
      };
    }),
    escalations: items
      .filter((i) => i.status === "READY" && i.readyAt && now - i.readyAt.getTime() >= hotel.readyPickupAlertSec * 1000)
      .map((i) => ({
        orderItemId: i.id,
        tableLabel: labelOf.get(i.order.sessionId) ?? "?",
        itemName: i.nameSnapshot,
        waitingSec: Math.round((now - (i.readyAt?.getTime() ?? now)) / 1000),
      }))
      .sort((a, b) => b.waitingSec - a.waitingSec),
  };
}
