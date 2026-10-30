import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { db, unscopedDb, withTenant } from "@rms/db";
import { rooms } from "@rms/contracts";
import { env } from "../env";
import { getHotel } from "../lib/hotel";
import { emit } from "../realtime/io";
import { billView, PAYMENT_LOCK_MS, settleIfPaid } from "../services/billing";
import { waiterRooms } from "../services/notify";
import { QUEUE, queue, type JobData } from "./queue";

/** READY item not picked up within readyPickupAlertSec → alert managers (and the waiter again). */
async function pickupEscalation(hotelId: string, orderItemId: string) {
  await withTenant(hotelId, async () => {
    const item = await db.orderItem.findUnique({
      where: { id: orderItemId },
      include: { order: { include: { session: { include: { table: true } } } } },
    });
    if (!item || item.status !== "READY" || !item.readyAt) return;
    const tableId = item.order.session.tableId;
    emit("pickup:escalated", [rooms.managers(hotelId), ...(await waiterRooms(hotelId, tableId))], {
      hotelId,
      orderItemId,
      tableLabel: item.order.session.table.label,
      itemName: item.nameSnapshot,
      waitingSec: Math.round((Date.now() - item.readyAt.getTime()) / 1000),
    });
  });
}

/**
 * Periodic housekeeping across all hotels:
 *  - close abandoned sessions (no orders, idle past hotel.sessionIdleMin) and free their tables
 *  - cancel pay-now orders nobody paid for within UNPAID_ORDER_MIN
 *  - close tables that are fully paid (pay-now) and idle past hotel.sessionIdleMin
 *  - sweep idempotency keys older than 48h
 */
async function maintenance() {
  const candidates = await unscopedDb.tableSession.findMany({
    where: { status: "OPEN", orders: { none: {} } },
    select: { id: true, hotelId: true, tableId: true, lastActivityAt: true },
  });
  for (const s of candidates) {
    const hotel = await getHotel(s.hotelId);
    if (Date.now() - s.lastActivityAt.getTime() < hotel.sessionIdleMin * 60_000) continue;
    await unscopedDb.$transaction([
      unscopedDb.tableSession.updateMany({ where: { id: s.id, status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date() } }),
      unscopedDb.table.updateMany({ where: { id: s.tableId, status: "OCCUPIED" }, data: { status: "FREE" } }),
    ]);
    emit("table:status_changed", [rooms.managers(s.hotelId)], { hotelId: s.hotelId, tableId: s.tableId, status: "FREE" });
  }
  await expireUnpaidOrders();
  await closePaidIdleSessions();
  await unscopedDb.idempotencyKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 48 * 3600_000) } } });
}

const UNPAID_ORDER_MIN = 30;

async function expireUnpaidOrders() {
  const cutoff = new Date(Date.now() - UNPAID_ORDER_MIN * 60_000);
  const lockCutoff = new Date(Date.now() - PAYMENT_LOCK_MS);
  const stale = await unscopedDb.order.findMany({
    where: {
      status: "AWAITING_PAYMENT",
      placedAt: { lt: cutoff },
      payments: { none: { OR: [{ status: "SUCCESS" }, { status: "PENDING", createdAt: { gt: lockCutoff } }] } },
    },
    select: { id: true, hotelId: true, sessionId: true },
  });
  for (const o of stale) {
    const done = await unscopedDb.$transaction(async (tx) => {
      const r = await tx.order.updateMany({ where: { id: o.id, status: "AWAITING_PAYMENT" }, data: { status: "CANCELLED" } });
      if (r.count) await tx.orderItem.updateMany({ where: { orderId: o.id }, data: { status: "CANCELLED", cancelReason: "Payment not completed" } });
      return r.count > 0;
    });
    if (done) emit("order:cancelled", [rooms.session(o.sessionId)], { hotelId: o.hotelId, orderId: o.id, sessionId: o.sessionId, reason: "Payment not completed" });
  }
}

async function closePaidIdleSessions() {
  const live = await unscopedDb.tableSession.findMany({
    where: { status: { in: ["OPEN", "BILLING"] }, payments: { some: { status: "SUCCESS" } } },
    select: { id: true, hotelId: true, lastActivityAt: true },
  });
  for (const s of live) {
    const hotel = await getHotel(s.hotelId);
    if (Date.now() - s.lastActivityAt.getTime() < hotel.sessionIdleMin * 60_000) continue;
    await withTenant(s.hotelId, async () => {
      const view = await billView(s.id);
      if (view.due === 0) await settleIfPaid(s.id);
    });
  }
}

export async function startWorker() {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker<JobData>(
    QUEUE,
    async (job) => {
      if (job.data.kind === "pickup-escalation") return pickupEscalation(job.data.hotelId, job.data.orderItemId);
      if (job.data.kind === "maintenance") return maintenance();
    },
    { connection, concurrency: 10 },
  );
  worker.on("failed", (job, err) => console.error(`job ${job?.id} failed:`, err.message));
  await queue.upsertJobScheduler("maintenance", { every: 10 * 60_000 }, { name: "maintenance", data: { kind: "maintenance" } });
  return async () => {
    await worker.close();
    connection.disconnect();
  };
}
