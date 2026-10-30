import { db, type StaffRole } from "@rms/db";
import { rooms } from "@rms/contracts";
import { audit } from "../lib/audit";
import { conflict, notFound } from "../lib/errors";
import { joinCode } from "../lib/crypto";
import { getHotel } from "../lib/hotel";
import { assertOwned } from "../lib/owned";
import { emit } from "../realtime/io";
import { invalidateMenu } from "./menu";
import { waiterRooms } from "./notify";
import { announceOrder, createOrder, releaseOrders } from "./orders";
import { orderInclude } from "./views";

/**
 * Staff mutations shared by the REST routes, POST /v1/s/sync (device offline queue)
 * and POST /v1/hub/sync (local hub replay). All run inside withTenant().
 */

export interface StaffActor {
  hid: string;
  staffId: string;
  role: StaffRole;
}

export type ActionOutcome = "APPLIED" | "NOOP";

/**
 * Out-of-stock toggle. Last writer wins by device time: a toggle made offline at 12:01
 * never overrides one made online at 12:05.
 */
export async function setAvailability(a: StaffActor, menuItemId: string, isAvailable: boolean, at?: Date): Promise<ActionOutcome> {
  const item = await db.menuItem.findUnique({ where: { id: menuItemId }, select: { updatedAt: true } });
  if (!item) throw notFound("Menu item");
  if (at && at < item.updatedAt) return "NOOP";
  const r = await db.menuItem.updateMany({ where: { id: menuItemId, isAvailable: !isAvailable }, data: { isAvailable } });
  if (r.count === 0) return "NOOP";
  invalidateMenu(a.hid);
  await audit(a.staffId, "MENU_AVAILABILITY", "MenuItem", menuItemId, { isAvailable });
  emit("menu:item_availability", [rooms.menu(a.hid), rooms.kitchen(a.hid), rooms.managers(a.hid)], { hotelId: a.hid, menuItemId, isAvailable });
  return "APPLIED";
}

export async function ackRequest(a: StaffActor, id: string): Promise<ActionOutcome> {
  const r = await db.serviceRequest.updateMany({ where: { id, status: "OPEN" }, data: { status: "ACKNOWLEDGED", ackAt: new Date(), handledById: a.staffId } });
  if (r.count === 0) return "NOOP";
  const sr = await db.serviceRequest.findUniqueOrThrow({ where: { id } });
  emit("request:acknowledged", [rooms.session(sr.sessionId), rooms.managers(a.hid)], { hotelId: a.hid, requestId: id, sessionId: sr.sessionId, byStaffId: a.staffId });
  return "APPLIED";
}

export async function doneRequest(a: StaffActor, id: string): Promise<ActionOutcome> {
  const r = await db.serviceRequest.updateMany({ where: { id, status: { not: "DONE" } }, data: { status: "DONE", doneAt: new Date(), handledById: a.staffId } });
  if (r.count === 0) return "NOOP";
  const sr = await db.serviceRequest.findUniqueOrThrow({ where: { id } });
  emit("request:done", [rooms.session(sr.sessionId), rooms.managers(a.hid)], { hotelId: a.hid, requestId: id, sessionId: sr.sessionId });
  return "APPLIED";
}

/** Waiter confirms real guests are seated → held QR orders go to the kitchen. */
export async function confirmSession(a: StaffActor, sessionId: string): Promise<ActionOutcome> {
  const s = await db.tableSession.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound("Session");
  if (s.status === "CLOSED") return "NOOP";
  if (!s.isConfirmed) {
    await db.tableSession.update({ where: { id: sessionId }, data: { isConfirmed: true } });
    emit("session:confirmed", [rooms.session(sessionId), rooms.managers(a.hid), ...(await waiterRooms(a.hid, s.tableId))], {
      hotelId: a.hid,
      sessionId,
      byStaffId: a.staffId,
    });
  }
  await releaseOrders({ sessionId, status: "PENDING_CONFIRMATION" }, a.staffId);
  return "APPLIED";
}

export interface StaffOrderParams {
  clientId: string;
  tableId: string;
  lines: { id?: string; itemId: string; variantId?: string | null; addonIds: readonly string[]; quantity: number; note?: string | null }[];
  note?: string;
}

/** Waiter takes an order for a table: opens a session if needed; the waiter is the confirmation. */
export async function placeStaffOrder(a: StaffActor, p: StaffOrderParams) {
  // A replay (offline queue, hub) must not open a fresh session if the table was closed since.
  const existing = await db.order.findUnique({ where: { hotelId_clientId: { hotelId: a.hid, clientId: p.clientId } }, include: orderInclude });
  if (existing) return { order: existing, created: false };
  await assertOwned("table", [p.tableId]);
  const hotel = await getHotel(a.hid);
  let session = await db.tableSession.findFirst({ where: { tableId: p.tableId, status: { in: ["OPEN", "BILLING"] } } });
  if (!session) {
    const table = await db.table.findUniqueOrThrow({ where: { id: p.tableId } });
    if (!table.isActive) throw conflict("TABLE_INACTIVE", "This table is no longer in use");
    session = await db.$transaction(async (tx) => {
      const s = await tx.tableSession.create({ data: { hotelId: a.hid, tableId: p.tableId, joinCode: joinCode(), isConfirmed: true } });
      await tx.table.update({ where: { id: p.tableId }, data: { status: "OCCUPIED" } });
      return s;
    });
    emit("table:status_changed", [rooms.managers(a.hid)], { hotelId: a.hid, tableId: p.tableId, status: "OCCUPIED" });
  }
  const result = await createOrder({
    hotel,
    sessionId: session.id,
    clientId: p.clientId,
    source: "WAITER",
    status: "PLACED",
    takenById: a.staffId,
    note: p.note,
    lines: p.lines.map((l, i) => ({ ...l, ref: String(i) })),
  });
  if (result.created) await announceOrder(result.order);
  return result;
}
