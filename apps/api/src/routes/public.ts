import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, unscopedDb, withTenant } from "@rms/db";
import { CreateRequestInput, Id, JoinSessionInput, PlaceOrderInput, ReplaceItemInput, UpsertCartItemInput, rooms, type ReceiptView } from "@rms/contracts";
import { AppError, conflict, isUniqueViolation, notFound, parse } from "../lib/errors";
import { setGuestCookie } from "../lib/auth";
import { assertHotelOperational, getHotel } from "../lib/hotel";
import { guest } from "../lib/route";
import { emit } from "../realtime/io";
import { loadPublicMenu, priceSelections } from "../services/menu";
import { broadcastCart, joinSession, lookupTable, sessionView } from "../services/sessions";
import { announceOrder, createOrder } from "../services/orders";
import { replaceItem, transitionItem } from "../services/items";
import { billView, PAYMENT_LOCK_MS, receiptUrl, settleIfPaid, verifyReceiptToken } from "../services/billing";
import { gatewayFor } from "../payments/gateway";
import { waiterRooms } from "../services/notify";
import { orderInclude, requestInclude, toOrderView, toRequestView } from "../services/views";

const IdParam = z.object({ id: Id });

/** Customer (QR, no login). Every route is rate-limited by the public prefix limit set in app.ts. */
export async function publicRoutes(app: FastifyInstance) {
  app.get("/v1/p/t/:qrToken", async (req) => {
    const { qrToken } = parse(z.object({ qrToken: z.string().min(1).max(64) }), req.params);
    const { deviceId } = parse(z.object({ deviceId: z.string().max(64).optional() }), req.query);
    return lookupTable(qrToken, deviceId);
  });

  /** Menu with ETag: repeat loads on slow 4G cost a 304. */
  app.get("/v1/p/h/:slug/menu", async (req, reply) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(48) }), req.params);
    const h = await unscopedDb.hotel.findUnique({ where: { slug }, select: { id: true } });
    if (!h) throw notFound("Restaurant");
    const hotel = await getHotel(h.id);
    assertHotelOperational(hotel);
    const menu = await withTenant(hotel.id, () => loadPublicMenu(hotel));
    const etag = `"${menu.version}"`;
    reply.header("etag", etag).header("cache-control", "no-cache");
    if (req.headers["if-none-match"] === etag) return reply.status(304).send();
    return menu;
  });

  app.post("/v1/p/sessions/join", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const input = parse(JoinSessionInput, req.body);
    const { hotel, sessionId, guestId } = await joinSession(input);
    const guestToken = await setGuestCookie(reply, { typ: "guest", sub: guestId, hid: hotel.id, ses: sessionId });
    const view = await withTenant(hotel.id, () => sessionView(sessionId, guestId));
    return { session: view, guestToken };
  });

  app.get("/v1/p/session", guest(async (_req, _reply, g) => sessionView(g.ses, g.sub)));

  // ── Shared cart ───────────────────────────────
  app.put(
    "/v1/p/cart/items/:id",
    guest(async (req, _reply, g) => {
      const { id } = parse(z.object({ id: z.string().min(8).max(64) }), req.params);
      const input = parse(UpsertCartItemInput, req.body);
      const hotel = await getHotel(g.hid);
      const [priced] = await priceSelections(hotel, [{ ...input, variantId: input.variantId ?? null }]);
      if (!priced?.ok) throw new AppError(409, "ITEM_UNAVAILABLE", "This item can't be added right now", priced?.errors);
      const existing = await db.cartItem.findUnique({ where: { id } });
      if (existing && existing.sessionId !== g.ses) throw notFound("Cart item");
      const data = {
        itemId: input.itemId,
        variantId: input.variantId ?? null,
        addonIds: [...input.addonIds],
        quantity: input.quantity,
        note: input.note ?? null,
      };
      if (existing) await db.cartItem.update({ where: { id }, data });
      else await db.cartItem.create({ data: { id, hotelId: g.hid, sessionId: g.ses, guestId: g.sub, ...data } });
      await db.tableSession.update({ where: { id: g.ses }, data: { lastActivityAt: new Date() } });
      await broadcastCart(hotel, g.ses);
      return sessionView(g.ses, g.sub);
    }),
  );

  app.delete(
    "/v1/p/cart/items/:id",
    guest(async (req, _reply, g) => {
      const { id } = parse(z.object({ id: z.string().min(1).max(64) }), req.params);
      await db.cartItem.deleteMany({ where: { id, sessionId: g.ses } });
      await broadcastCart(await getHotel(g.hid), g.ses);
      return sessionView(g.ses, g.sub);
    }),
  );

  // ── Orders ────────────────────────────────────
  /** Checkout the whole shared cart. clientId makes double taps / retries return the same order. */
  app.post(
    "/v1/p/orders",
    guest(async (req, reply, g) => {
      const input = parse(PlaceOrderInput, req.body);
      const hotel = await getHotel(g.hid);
      const session = await db.tableSession.findUniqueOrThrow({ where: { id: g.ses } });
      if (input.payment === "PAY_LATER" && !hotel.allowPayLater) {
        throw new AppError(422, "PAY_LATER_DISABLED", "Please pay now to place this order");
      }
      if (input.payment === "PAY_NOW" && (!hotel.allowPayNow || !gatewayFor(hotel))) {
        throw new AppError(422, "PAY_NOW_UNAVAILABLE", "Paying now isn't available here. Choose pay later.");
      }
      const cart = await db.cartItem.findMany({ where: { sessionId: g.ses }, orderBy: { updatedAt: "asc" } });
      // Pay-now orders are held until UPI succeeds; a paid order needs no waiter confirmation.
      const status =
        input.payment === "PAY_NOW" ? "AWAITING_PAYMENT" : hotel.requireWaiterConfirm && !session.isConfirmed ? "PENDING_CONFIRMATION" : "PLACED";
      const { order, created } = await createOrder({
        hotel,
        sessionId: g.ses,
        clientId: input.clientId,
        source: "QR_CUSTOMER",
        status,
        note: input.note,
        clearCart: true,
        // only the dish choices: cart line ids are the phone's own and must never become order item ids
        lines: cart.map((c) => ({ itemId: c.itemId, variantId: c.variantId, addonIds: c.addonIds, quantity: c.quantity, note: c.note, guestId: c.guestId, ref: c.id })),
      });
      if (created) {
        await announceOrder(order);
        await broadcastCart(hotel, g.ses);
      }
      reply.status(created ? 201 : 200);
      return toOrderView(order);
    }),
  );

  app.get(
    "/v1/p/orders",
    guest(async (_req, _reply, g) => {
      const orders = await db.order.findMany({ where: { sessionId: g.ses }, include: orderInclude, orderBy: { placedAt: "asc" } });
      return orders.map(toOrderView);
    }),
  );

  /** Guest gives up on a pay-now order before paying. Refused while a UPI attempt for it is in flight. */
  app.post(
    "/v1/p/orders/:id/cancel",
    guest(async (req, _reply, g) => {
      const { id } = parse(IdParam, req.params);
      const order = await db.order.findUnique({ where: { id } });
      if (!order || order.sessionId !== g.ses) throw notFound("Order");
      const paying = await db.payment.count({
        where: { orderId: id, status: { in: ["PENDING", "SUCCESS"] }, createdAt: { gt: new Date(Date.now() - PAYMENT_LOCK_MS) } },
      });
      if (paying) throw conflict("PAYMENT_IN_PROGRESS", "Payment for this order is in progress");
      const r = await db.$transaction(async (tx) => {
        const u = await tx.order.updateMany({ where: { id, status: "AWAITING_PAYMENT" }, data: { status: "CANCELLED" } });
        if (u.count) await tx.orderItem.updateMany({ where: { orderId: id }, data: { status: "CANCELLED", cancelReason: "Not paid" } });
        return u.count;
      });
      if (!r && order.status !== "CANCELLED") throw conflict("ALREADY_PAID", "This order is already paid");
      emit("order:cancelled", [rooms.session(g.ses)], { hotelId: g.hid, orderId: id, sessionId: g.ses, reason: "Not paid" });
      return { ok: true };
    }),
  );

  /** Remove an item the kitchen marked OUT_OF_STOCK. */
  app.post(
    "/v1/p/order-items/:id/remove",
    guest(async (req, _reply, g) => {
      const { id } = parse(IdParam, req.params);
      const item = await db.orderItem.findUnique({ where: { id }, select: { order: { select: { sessionId: true } } } });
      if (!item || item.order.sessionId !== g.ses) throw notFound("Order item");
      const outcome = await transitionItem({ role: "CUSTOMER", staffId: null }, id, "CANCELLED");
      return { outcome };
    }),
  );

  /** Swap an OUT_OF_STOCK item for something else on the menu (same quantity, same ticket). */
  app.post(
    "/v1/p/order-items/:id/replace",
    guest(async (req, reply, g) => {
      const { id } = parse(IdParam, req.params);
      const input = parse(ReplaceItemInput, req.body);
      const item = await db.orderItem.findUnique({ where: { id }, select: { order: { select: { sessionId: true } } } });
      if (!item || item.order.sessionId !== g.ses) throw notFound("Order item");
      const replacementId = await replaceItem({ role: "CUSTOMER", staffId: null }, id, input);
      reply.status(201);
      return { replacementId };
    }),
  );

  // ── Service requests (call waiter, water, bill…) ──
  /** One open request per type per table: repeated taps return the same request instead of spamming staff. */
  app.post(
    "/v1/p/requests",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    guest(async (req, reply, g) => {
      const input = parse(CreateRequestInput, req.body);
      const session = await db.tableSession.findUniqueOrThrow({ where: { id: g.ses }, include: { table: true } });
      let request;
      try {
        request = await db.serviceRequest.create({
          data: { hotelId: g.hid, sessionId: g.ses, type: input.type, note: input.note ?? null },
          include: requestInclude,
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const open = await db.serviceRequest.findFirst({ where: { sessionId: g.ses, type: input.type, status: "OPEN" }, include: requestInclude });
        if (!open) throw e;
        return toRequestView(open);
      }
      const waiters = await waiterRooms(g.hid, session.tableId);
      emit("request:created", [...waiters, rooms.managers(g.hid), rooms.session(g.ses)], {
        hotelId: g.hid,
        requestId: request.id,
        sessionId: g.ses,
        tableLabel: session.table.label,
        type: request.type,
      });
      if (input.type === "BILL") {
        await db.$transaction([
          db.tableSession.update({ where: { id: g.ses }, data: { status: "BILLING" } }),
          db.table.update({ where: { id: session.tableId }, data: { status: "BILL_REQUESTED" } }),
        ]);
        emit("bill:requested", [...waiters, rooms.cashiers(g.hid), rooms.managers(g.hid)], {
          hotelId: g.hid,
          sessionId: g.ses,
          tableLabel: session.table.label,
        });
        emit("table:status_changed", [...waiters, rooms.managers(g.hid)], { hotelId: g.hid, tableId: session.tableId, status: "BILL_REQUESTED" });
      }
      reply.status(201);
      return toRequestView(request);
    }),
  );

  app.get(
    "/v1/p/requests",
    guest(async (_req, _reply, g) => {
      const rs = await db.serviceRequest.findMany({ where: { sessionId: g.ses, status: { not: "DONE" } }, include: requestInclude });
      return rs.map(toRequestView);
    }),
  );

  app.get("/v1/p/bill", guest(async (_req, _reply, g) => billView(g.ses)));

  /** Guests who paid everything up front (pay-now) tap "we're leaving": close the bill and free the table. */
  app.post(
    "/v1/p/session/leave",
    guest(async (_req, _reply, g) => {
      const view = await billView(g.ses);
      if (view.due > 0 || view.paid === 0) throw conflict("BILL_DUE", "Please pay the bill first");
      await settleIfPaid(g.ses);
      return { receiptUrl: receiptUrl(view.id) };
    }),
  );

  /** Digital GST receipt behind an unguessable signed link (shared on WhatsApp / SMS). */
  app.get("/v1/r/:token", async (req): Promise<ReceiptView> => {
    const { token } = parse(z.object({ token: z.string().min(10).max(120) }), req.params);
    const billId = verifyReceiptToken(token);
    const found = billId ? await unscopedDb.bill.findUnique({ where: { id: billId }, select: { hotelId: true, sessionId: true, status: true } }) : null;
    if (!found || found.status !== "PAID") throw notFound("Receipt");
    const hotel = await getHotel(found.hotelId);
    return withTenant(hotel.id, async () => {
      const [bill, payments, row] = await Promise.all([
        billView(found.sessionId),
        db.payment.findMany({ where: { sessionId: found.sessionId, status: "SUCCESS" }, select: { method: true, amount: true }, orderBy: { createdAt: "asc" } }),
        db.bill.findUniqueOrThrow({ where: { id: billId ?? "" }, select: { closedAt: true } }),
      ]);
      return {
        hotel: { name: hotel.name, address: hotel.address, phone: hotel.phone, gstin: hotel.gstin, timezone: hotel.timezone },
        bill,
        closedAt: row.closedAt?.toISOString() ?? null,
        payments,
      };
    });
  });
}
