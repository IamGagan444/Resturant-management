import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, Prisma, unscopedDb, withTenant } from "@rms/db";
import { Id, StartUpiPaymentInput, type UpiCheckout } from "@rms/contracts";
import { env } from "../env";
import { AppError, notFound, parse } from "../lib/errors";
import { hmacSha256Hex } from "../lib/crypto";
import { getHotel } from "../lib/hotel";
import { guest } from "../lib/route";
import { announceBill, billView, markPaymentSuccess, receiptUrl, reserveUpiPayment } from "../services/billing";
import { gatewayFor, MOCK_SECRET } from "../payments/gateway";

const IdParam = z.object({ id: Id });

export async function paymentRoutes(app: FastifyInstance) {
  /**
   * Start a UPI payment for a pay-now order, the whole bill, or one split.
   * Amount is always computed here, never sent by the client. One attempt at a time per bill (see reserveUpiPayment).
   */
  app.post(
    "/v1/p/payments/upi",
    guest(async (req, reply, g): Promise<UpiCheckout> => {
      const input = parse(StartUpiPaymentInput, req.body);
      const hotel = await getHotel(g.hid);
      const gateway = gatewayFor(hotel);
      if (!gateway) throw new AppError(422, "UPI_NOT_CONFIGURED", "UPI isn't set up here. Please pay at the counter.");

      let p = await db.payment.findUnique({ where: { hotelId_clientId: { hotelId: g.hid, clientId: input.clientId } } });
      if (p && p.sessionId !== g.ses) throw notFound("Payment");
      if (p && p.status !== "PENDING") throw new AppError(409, "PAYMENT_CLOSED", "This payment attempt has ended. Start again.");
      p ??= await reserveUpiPayment({ hotel, sessionId: g.ses, clientId: input.clientId, target: input.target });
      if (!p.gatewayOrderId) {
        try {
          const { gatewayOrderId } = await gateway.createOrder({ amount: p.amount, currency: hotel.currency, receipt: p.id });
          p = await db.payment.update({ where: { id: p.id }, data: { gatewayOrderId } });
        } catch (e) {
          await db.payment.update({ where: { id: p.id }, data: { status: "FAILED", gatewayRef: "GATEWAY_ERROR" } });
          req.log.error(e);
          throw new AppError(502, "GATEWAY_UNAVAILABLE", "UPI is not responding. Try again or pay at the counter.");
        }
        reply.status(201);
      }
      if (!p.gatewayOrderId) throw new Error("unreachable: gateway order missing");
      return { paymentId: p.id, gateway: "razorpay", keyId: gateway.keyId, gatewayOrderId: p.gatewayOrderId, amount: p.amount, currency: hotel.currency };
    }),
  );

  /** Guest closed the UPI sheet: release the lock so someone else (or the counter) can take payment. */
  app.post(
    "/v1/p/payments/:id/cancel",
    guest(async (req, _reply, g) => {
      const { id } = parse(IdParam, req.params);
      const r = await db.payment.updateMany({ where: { id, sessionId: g.ses, status: "PENDING" }, data: { status: "FAILED" } });
      if (r.count) {
        const view = await billView(g.ses);
        announceBill(g.hid, view.id, g.ses);
      }
      return { ok: true };
    }),
  );

  /** Checkout success callback from the browser. Signature-verified; the webhook is the backup path. */
  app.post(
    "/v1/p/payments/:id/verify",
    guest(async (req, _reply, g) => {
      const { id } = parse(IdParam, req.params);
      const body = parse(z.object({ gatewayPaymentId: z.string().min(1).max(64), signature: z.string().min(1).max(256) }), req.body);
      const p = await db.payment.findUnique({ where: { id } });
      if (!p || p.sessionId !== g.ses || !p.gatewayOrderId) throw notFound("Payment");
      const gateway = gatewayFor(await getHotel(g.hid));
      if (!gateway?.verifyCheckout({ gatewayOrderId: p.gatewayOrderId, gatewayPaymentId: body.gatewayPaymentId, signature: body.signature })) {
        throw new AppError(400, "BAD_SIGNATURE", "Payment could not be verified");
      }
      await markPaymentSuccess(p.id, body.gatewayPaymentId);
      // fully paid → the guest's thank-you screen shows the digital bill
      const settled = await db.bill.findFirst({ where: { sessionId: g.ses, status: "PAID" }, select: { id: true } });
      return { ok: true, receiptUrl: settled ? receiptUrl(settled.id) : null };
    }),
  );

  /**
   * Razorpay webhook, one URL per hotel (each hotel has its own webhook secret).
   * Raw body is needed for the HMAC, so this plugin parses JSON as a Buffer.
   */
  app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    scope.post("/v1/webhooks/razorpay/:hotelId", async (req, reply) => {
      const { hotelId } = parse(z.object({ hotelId: Id }), req.params);
      const raw = req.body as Buffer;
      const signature = req.headers["x-razorpay-signature"];
      const eventId = req.headers["x-razorpay-event-id"];
      const hotel = await unscopedDb.hotel.findUnique({ where: { id: hotelId } });
      const gateway = hotel ? gatewayFor(hotel) : null;
      if (!hotel || !gateway || typeof signature !== "string" || !gateway.verifyWebhook(raw, signature)) {
        return reply.status(400).send({ error: { code: "BAD_SIGNATURE", message: "Invalid webhook" } });
      }
      const event = JSON.parse(raw.toString("utf8")) as RazorpayEvent;
      const id = typeof eventId === "string" ? eventId : `${event.event}:${event.payload?.payment?.entity?.id ?? ""}`;
      try {
        await unscopedDb.webhookEvent.create({ data: { provider: "razorpay", eventId: id, hotelId, payload: event as unknown as Prisma.InputJsonValue } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: true, duplicate: true };
        throw e;
      }
      await withTenant(hotelId, () => handleRazorpayEvent(event));
      await unscopedDb.webhookEvent.update({ where: { provider_eventId: { provider: "razorpay", eventId: id } }, data: { processedAt: new Date() } });
      return { ok: true };
    });
  });

  /** Dev only: complete a mock UPI payment as if Razorpay Checkout succeeded. */
  if (env.PAYMENTS_MOCK) {
    app.post(
      "/v1/dev/payments/:id/succeed",
      guest(async (req, _reply, g) => {
        const { id } = parse(IdParam, req.params);
        const p = await db.payment.findUnique({ where: { id } });
        if (!p || p.sessionId !== g.ses || !p.gatewayOrderId) throw notFound("Payment");
        const gatewayPaymentId = `pay_mock_${p.id.slice(-8)}`;
        return { gatewayPaymentId, signature: hmacSha256Hex(MOCK_SECRET, `${p.gatewayOrderId}|${gatewayPaymentId}`) };
      }),
    );
  }
}

interface RazorpayEvent {
  event: string;
  payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } } };
}

async function handleRazorpayEvent(event: RazorpayEvent) {
  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id) return;
  const p = await db.payment.findUnique({ where: { gatewayOrderId: entity.order_id } });
  if (!p) return;
  if (event.event === "payment.captured" || event.event === "order.paid") {
    if (entity.amount !== undefined && entity.amount !== p.amount) {
      await db.payment.update({ where: { id: p.id }, data: { status: "FAILED", gatewayRef: "AMOUNT_MISMATCH" } });
      return; // amount tampering / mismatch: never settle the bill on it
    }
    await markPaymentSuccess(p.id, entity.id ?? null);
  } else if (event.event === "payment.failed") {
    const r = await db.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "FAILED" } });
    if (r.count) announceBill(p.hotelId, (await billView(p.sessionId)).id, p.sessionId);
  }
}
