import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@rms/db";
import {
  AdjustBillInput,
  AvailabilityInput,
  Id,
  ItemTransitionInput,
  RecordPaymentInput,
  ReplaceItemInput,
  SendBillInput,
  SplitBillInput,
  StaffPlaceOrderInput,
  SyncInput,
  TableStatusInput,
  rooms,
  type DayReport,
  type FloorView,
  type KdsTicket,
  type SendBillResult,
  type SyncResult,
  type WaiterBoard,
} from "@rms/contracts";
import type { Actor } from "@rms/domain";
import { AppError, conflict, notFound, parse } from "../lib/errors";
import { audit } from "../lib/audit";
import { businessDay, getHotel } from "../lib/hotel";
import { ANY_STAFF, CASH, FLOOR, KITCHEN, MANAGERS, staff } from "../lib/route";
import type { StaffClaims } from "../lib/auth";
import { emit } from "../realtime/io";
import { loadPublicMenu } from "../services/menu";
import { bumpOrder, replaceItem, transitionItem } from "../services/items";
import { releaseOrders } from "../services/orders";
import { afterPayment, billView, liveBill, receiptUrl, settleIfPaid, splitBill } from "../services/billing";
import { dayReport, floorView } from "../services/reports";
import { waiterRooms } from "../services/notify";
import { toOrderView } from "../services/views";
import { kdsTickets, waiterBoard } from "../services/floorData";
import { ackRequest, confirmSession, doneRequest, placeStaffOrder, setAvailability, type StaffActor } from "../services/staffActions";
import { runCommands } from "../services/commands";

const IdParam = z.object({ id: Id });
const actorOf = (c: StaffClaims) => ({ role: c.role as Actor, staffId: c.sub });
const actorFrom = (c: StaffClaims): StaffActor => ({ hid: c.hid, staffId: c.sub, role: c.role });

export async function staffRoutes(app: FastifyInstance) {
  // ── Shared ────────────────────────────────────
  app.get(
    "/v1/s/menu",
    staff(ANY_STAFF, async (_req, _reply, ctx) => loadPublicMenu(await getHotel(ctx.hid))),
  );
  app.get(
    "/v1/s/stations",
    staff(ANY_STAFF, async () => db.station.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } })),
  );

  // ── Kitchen display ───────────────────────────
  /** Active tickets. `station=all` (or a cook without station) sees everything; items with no station show everywhere. */
  app.get(
    "/v1/s/kds",
    staff(KITCHEN, async (req, _reply, ctx): Promise<KdsTicket[]> => {
      const q = parse(z.object({ station: z.string().max(64).optional() }), req.query);
      return kdsTickets(q.station === "all" ? null : (q.station ?? ctx.sid));
    }),
  );

  /** The only status-change endpoint. Forward-only: stale/duplicate calls return NOOP, never an error. */
  app.post(
    "/v1/s/order-items/:id/transition",
    staff(ANY_STAFF, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const input = parse(ItemTransitionInput, req.body);
      const outcome = await transitionItem(actorOf(ctx), id, input.to, input.reason);
      return { outcome };
    }),
  );

  app.post(
    "/v1/s/orders/:id/bump",
    staff(KITCHEN, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      return { applied: await bumpOrder(actorOf(ctx), id, ctx.sid) };
    }),
  );

  /** One-tap out of stock: disappears from customer menus instantly. */
  app.get(
    "/v1/s/menu-items",
    staff(KITCHEN, async () =>
      db.menuItem.findMany({
        where: { isActive: true },
        select: { id: true, name: true, isAvailable: true, stationId: true, categoryId: true },
        orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
      }),
    ),
  );
  app.patch(
    "/v1/s/menu-items/:id/availability",
    staff(KITCHEN, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const { isAvailable } = parse(AvailabilityInput, req.body);
      return { ok: true, changed: (await setAvailability(actorFrom(ctx), id, isAvailable)) === "APPLIED" };
    }),
  );

  // ── Waiter ────────────────────────────────────
  /** Waiter's tables (assigned today; all tables if no assignments exist for them) with everything needing action. */
  app.get(
    "/v1/s/waiter/board",
    staff(FLOOR, async (_req, _reply, ctx): Promise<WaiterBoard> => waiterBoard(await getHotel(ctx.hid), ctx.role === "WAITER" ? ctx.sub : null)),
  );

  /** Waiter confirms real guests are seated → held QR orders go to the kitchen. */
  app.post(
    "/v1/s/sessions/:id/confirm",
    staff(FLOOR, async (req, _reply, ctx) => {
      await confirmSession(actorFrom(ctx), parse(IdParam, req.params).id);
      return { ok: true };
    }),
  );

  app.post(
    "/v1/s/orders/:id/approve",
    staff(FLOOR, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const order = await db.order.findUnique({ where: { id } });
      if (!order) throw notFound("Order");
      await db.tableSession.update({ where: { id: order.sessionId }, data: { isConfirmed: true } });
      await releaseOrders({ id, status: "PENDING_CONFIRMATION" }, ctx.sub);
      return { ok: true };
    }),
  );

  app.post(
    "/v1/s/orders/:id/reject",
    staff(FLOOR, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(140) }), req.body);
      const r = await db.$transaction(async (tx) => {
        const u = await tx.order.updateMany({ where: { id, status: "PENDING_CONFIRMATION" }, data: { status: "CANCELLED" } });
        if (u.count === 0) return null;
        await tx.orderItem.updateMany({ where: { orderId: id }, data: { status: "CANCELLED", cancelReason: reason } });
        await audit(ctx.sub, "ORDER_REJECTED", "Order", id, { reason }, tx);
        return tx.order.findUniqueOrThrow({ where: { id } });
      });
      if (!r) throw conflict("NOT_PENDING", "Order is no longer waiting for confirmation");
      emit("order:cancelled", [rooms.session(r.sessionId), rooms.managers(ctx.hid)], { hotelId: ctx.hid, orderId: id, sessionId: r.sessionId, reason });
      return { ok: true };
    }),
  );

  /** Waiter takes an order for a table. Same pipeline as QR orders; waiter = confirmation. */
  app.post(
    "/v1/s/orders",
    staff(FLOOR, async (req, reply, ctx) => {
      const input = parse(StaffPlaceOrderInput, req.body);
      const { order, created } = await placeStaffOrder(actorFrom(ctx), input);
      reply.status(created ? 201 : 200);
      return toOrderView(order);
    }),
  );

  app.post(
    "/v1/s/requests/:id/ack",
    staff(FLOOR, async (req, _reply, ctx) => {
      await ackRequest(actorFrom(ctx), parse(IdParam, req.params).id);
      return { ok: true };
    }),
  );

  app.post(
    "/v1/s/requests/:id/done",
    staff(FLOOR, async (req, _reply, ctx) => {
      await doneRequest(actorFrom(ctx), parse(IdParam, req.params).id);
      return { ok: true };
    }),
  );

  /** Offline queue flush: the device's commands, in order, as the signed-in staff member. */
  app.post(
    "/v1/s/sync",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    staff(ANY_STAFF, async (req, _reply, ctx): Promise<SyncResult> => {
      const { commands } = parse(SyncInput, req.body);
      return { results: await runCommands({ ...actorFrom(ctx), deviceId: ctx.did }, commands) };
    }),
  );

  /** CLEANING → FREE once the table is reset. Can't free a table that still has a live session. */
  app.post(
    "/v1/s/tables/:id/status",
    staff(FLOOR, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const { status } = parse(TableStatusInput, req.body);
      const live = await db.tableSession.count({ where: { tableId: id, status: { in: ["OPEN", "BILLING"] } } });
      if (live) throw new AppError(409, "TABLE_IN_USE", "Close the bill before freeing this table");
      await db.table.update({ where: { id }, data: { status } });
      emit("table:status_changed", [rooms.managers(ctx.hid), ...(await waiterRooms(ctx.hid, id))], { hotelId: ctx.hid, tableId: id, status });
      return { ok: true };
    }),
  );

  // ── Cashier ───────────────────────────────────
  /** Every live table with its running bill. */
  app.get(
    "/v1/s/bills/live",
    staff(CASH, async () => {
      const sessions = await db.tableSession.findMany({
        where: { status: { in: ["OPEN", "BILLING"] }, orders: { some: {} } },
        select: { id: true },
        orderBy: { openedAt: "asc" },
      });
      return Promise.all(sessions.map((s) => billView(s.id)));
    }),
  );

  app.get(
    "/v1/s/sessions/:id/bill",
    staff([...CASH, "WAITER"], async (req) => billView(parse(IdParam, req.params).id)),
  );

  /** Discount / remove service charge (service charge is optional by law). Both audited. */
  app.patch(
    "/v1/s/bills/:id",
    staff(CASH, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const input = parse(AdjustBillInput, req.body);
      const bill = await liveBill(id);
      if (input.discount !== undefined && input.discount > 0 && !input.discountReason) {
        throw new AppError(400, "REASON_REQUIRED", "Give a reason for the discount");
      }
      await db.bill.update({
        where: { id },
        data: {
          ...(input.discount !== undefined && { discount: input.discount }),
          ...(input.removeServiceCharge && { serviceChargeBps: 0 }),
        },
      });
      if (input.discount !== undefined && input.discount !== bill.discount) {
        await audit(ctx.sub, "DISCOUNT_APPLIED", "Bill", id, { from: bill.discount, to: input.discount, reason: input.discountReason ?? null });
      }
      if (input.removeServiceCharge && bill.serviceChargeBps > 0) {
        await audit(ctx.sub, "SERVICE_CHARGE_REMOVED", "Bill", id, { bps: bill.serviceChargeBps });
      }
      return billView(bill.sessionId);
    }),
  );

  /**
   * Cash / card collected at the counter, for the whole bill or one split. Idempotent by clientId.
   * Full payment closes the table. Refused while a guest is mid-UPI, so the table is never charged twice.
   */
  app.post(
    "/v1/s/payments",
    staff(CASH, async (req, reply, ctx) => {
      const input = parse(RecordPaymentInput, req.body);
      const existing = await db.payment.findUnique({ where: { hotelId_clientId: { hotelId: ctx.hid, clientId: input.clientId } } });
      if (existing) return billView(existing.sessionId);
      const bill = await liveBill(input.billId);
      const view = await billView(bill.sessionId);
      if (view.paymentInFlight) throw conflict("PAYMENT_IN_PROGRESS", "A guest is paying by UPI right now. Wait a minute, then refresh.");
      let max = view.due;
      if (input.splitId) {
        const split = view.splits.find((s) => s.id === input.splitId);
        if (!split || split.isPaid) throw conflict("SPLIT_PAID", "This part is already paid");
        max = Math.min(max, split.amount - split.paid);
      }
      if (input.amount > max) {
        throw new AppError(422, "AMOUNT_EXCEEDS_DUE", `Only ${max} paise is due. Give change for the rest.`, { due: max });
      }
      const payment = await db.payment.create({
        data: {
          hotelId: ctx.hid,
          sessionId: bill.sessionId,
          billId: bill.id,
          splitId: input.splitId ?? null,
          clientId: input.clientId,
          method: input.method,
          amount: input.amount,
          status: "SUCCESS",
          collectedById: ctx.sub,
        },
      });
      await afterPayment(payment);
      reply.status(201);
      return billView(bill.sessionId);
    }),
  );

  /** Split equally / by guest / by item, or undo (NONE). Guests then pay their part by UPI or at the counter. */
  app.post(
    "/v1/s/bills/:id/split",
    staff([...CASH, "WAITER"], async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const input = parse(SplitBillInput, req.body);
      const sessionId = await splitBill(id, input);
      await audit(ctx.sub, "BILL_SPLIT", "Bill", id, { type: input.type });
      return billView(sessionId);
    }),
  );

  /** Digital bill: returns WhatsApp / SMS links that open on the staff device, pre-filled with the receipt link. */
  app.post(
    "/v1/s/bills/:id/send",
    staff([...CASH, "WAITER"], async (req, _reply, ctx): Promise<SendBillResult> => {
      const { id } = parse(IdParam, req.params);
      const { phone } = parse(SendBillInput, req.body);
      const bill = await db.bill.findUnique({ where: { id } });
      if (!bill) throw notFound("Bill");
      if (bill.status !== "PAID") throw conflict("BILL_NOT_PAID", "The bill can be sent once it's paid");
      const digits = phone.replace(/\D/g, "");
      const intl = digits.length === 10 ? `91${digits}` : digits; // Indian mobile without country code
      await db.bill.update({ where: { id }, data: { sentToPhone: intl } });
      await audit(ctx.sub, "BILL_SENT", "Bill", id, { phone: intl });
      const hotel = await getHotel(ctx.hid);
      const url = receiptUrl(id);
      const text = `Thank you for dining at ${hotel.name}! Your bill ${bill.billNumber ?? ""}: ${url}`;
      return {
        receiptUrl: url,
        whatsappUrl: `https://wa.me/${intl}?text=${encodeURIComponent(text)}`,
        smsUrl: `sms:+${intl}?body=${encodeURIComponent(text)}`,
      };
    }),
  );

  /** Close a table whose bill is fully paid (e.g. everything was paid up front with pay-now). */
  app.post(
    "/v1/s/sessions/:id/close",
    staff([...CASH, "WAITER"], async (req) => {
      const { id } = parse(IdParam, req.params);
      const view = await billView(id);
      if (view.status !== "PAID") {
        if (view.due > 0) throw conflict("BILL_DUE", "This table still has an unpaid bill");
        if (view.paid === 0) throw conflict("NOTHING_PAID", "Nothing was ordered and paid at this table");
        await settleIfPaid(id);
      }
      return billView(id);
    }),
  );

  /** Waiter swaps an out-of-stock item for the guest. */
  app.post(
    "/v1/s/order-items/:id/replace",
    staff(FLOOR, async (req, reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const input = parse(ReplaceItemInput, req.body);
      const replacementId = await replaceItem(actorOf(ctx), id, input);
      reply.status(201);
      return { replacementId };
    }),
  );

  // ── Manager live view & reports ─────────────
  app.get(
    "/v1/s/floor",
    staff(MANAGERS, async (_req, _reply, ctx): Promise<FloorView> => floorView(await getHotel(ctx.hid))),
  );

  app.get(
    "/v1/s/reports/day",
    staff(CASH, async (req, _reply, ctx): Promise<DayReport> => {
      const hotel = await getHotel(ctx.hid);
      const { date } = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), req.query);
      return dayReport(hotel, date ?? businessDay(hotel).key);
    }),
  );

  // ── Manager-only cancel of a released item ───
  app.post(
    "/v1/s/order-items/:id/cancel",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { id } = parse(IdParam, req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1).max(140) }), req.body);
      return { outcome: await transitionItem(actorOf(ctx), id, "CANCELLED", reason) };
    }),
  );
}
