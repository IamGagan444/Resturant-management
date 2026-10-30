import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { unscopedDb, type Prisma } from "@rms/db";
import { CreateHotelInput, Id, PlanInput, UpdateHotelInput } from "@rms/contracts";
import { conflict, notFound, parse } from "../lib/errors";
import { hashSecret } from "../lib/crypto";
import { invalidateHotel } from "../lib/hotel";
import { platform } from "../lib/route";

const IdParam = z.object({ id: Id });

/** Super admin. Operates across tenants, so it uses the unscoped client deliberately. */
export async function platformRoutes(app: FastifyInstance) {
  app.get(
    "/v1/platform/hotels",
    platform(async () => {
      const hotels = await unscopedDb.hotel.findMany({
        orderBy: { createdAt: "desc" },
        include: { plan: { select: { id: true, name: true } }, _count: { select: { tables: true, staff: true } } },
      });
      return hotels.map((h) => ({
        id: h.id,
        name: h.name,
        slug: h.slug,
        status: h.status,
        plan: h.plan,
        trialEndsAt: h.trialEndsAt?.toISOString() ?? null,
        featureOverrides: h.featureOverrides,
        tables: h._count.tables,
        staff: h._count.staff,
        createdAt: h.createdAt.toISOString(),
      }));
    }),
  );

  /** Create hotel + owner + sensible defaults (GST 5%, one station, one floor) so setup starts at "add menu". */
  app.post(
    "/v1/platform/hotels",
    platform(async (req, reply) => {
      const input = parse(CreateHotelInput, req.body);
      if (await unscopedDb.hotel.findUnique({ where: { slug: input.slug } })) throw conflict("SLUG_TAKEN", "That URL name is taken");
      const email = input.owner.email.toLowerCase();
      if (await unscopedDb.staff.findUnique({ where: { email } })) throw conflict("EMAIL_TAKEN", "That email already has an account");
      const [passwordHash, pinHash] = await Promise.all([hashSecret(input.owner.password), hashSecret(input.owner.pin)]);

      const hotel = await unscopedDb.$transaction(async (tx) => {
        const h = await tx.hotel.create({
          data: {
            name: input.name,
            slug: input.slug,
            phone: input.phone ?? null,
            address: input.address ?? null,
            gstin: input.gstin ?? null,
            planId: input.planId ?? null,
            status: input.status,
            trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null,
          },
        });
        await tx.staff.create({
          data: { hotelId: h.id, name: input.owner.name, email, phone: input.owner.phone ?? null, role: "OWNER", passwordHash, pinHash },
        });
        await tx.tax.createMany({
          data: [
            { hotelId: h.id, name: "CGST", rateBps: 250 },
            { hotelId: h.id, name: "SGST", rateBps: 250 },
          ],
        });
        await tx.station.create({ data: { hotelId: h.id, name: "Kitchen" } });
        await tx.floor.create({ data: { hotelId: h.id, name: "Main" } });
        return h;
      });
      reply.status(201);
      return { id: hotel.id, slug: hotel.slug };
    }),
  );

  app.patch(
    "/v1/platform/hotels/:id",
    platform(async (req) => {
      const { id } = parse(IdParam, req.params);
      const input = parse(UpdateHotelInput, req.body);
      const data: Prisma.HotelUncheckedUpdateInput = {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.planId !== undefined && { planId: input.planId }),
        ...(input.trialEndsAt !== undefined && { trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null }),
        ...(input.featureOverrides !== undefined && { featureOverrides: input.featureOverrides ?? undefined }),
      };
      const h = await unscopedDb.hotel.update({ where: { id }, data });
      invalidateHotel(id);
      return { id: h.id, status: h.status };
    }),
  );

  app.get(
    "/v1/platform/plans",
    platform(async () => unscopedDb.plan.findMany({ orderBy: { priceMonthly: "asc" } })),
  );

  app.post(
    "/v1/platform/plans",
    platform(async (req, reply) => {
      const input = parse(PlanInput, req.body);
      reply.status(201);
      return unscopedDb.plan.create({ data: input });
    }),
  );

  app.get(
    "/v1/platform/health",
    platform(async () => {
      const since = new Date(Date.now() - 24 * 3600_000);
      const [activeHotels, ordersToday, failedPayments, failedSyncs, liveSessions] = await Promise.all([
        unscopedDb.hotel.count({ where: { status: { in: ["ACTIVE", "TRIAL"] } } }),
        unscopedDb.order.count({ where: { placedAt: { gte: since } } }),
        unscopedDb.payment.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
        unscopedDb.syncRejection.count({ where: { createdAt: { gte: since } } }),
        unscopedDb.tableSession.count({ where: { status: { in: ["OPEN", "BILLING"] } } }),
      ]);
      return { activeHotels, ordersLast24h: ordersToday, failedPaymentsLast24h: failedPayments, failedSyncsLast24h: failedSyncs, liveSessions };
    }),
  );

  app.get(
    "/v1/platform/hotels/:id",
    platform(async (req) => {
      const { id } = parse(IdParam, req.params);
      const h = await unscopedDb.hotel.findUnique({
        where: { id },
        include: { plan: true, staff: { where: { role: "OWNER" }, select: { id: true, name: true, email: true } } },
      });
      if (!h) throw notFound("Hotel");
      const { razorpayKeySecretEnc: _s, razorpayWebhookSecretEnc: _w, ...safe } = h;
      return safe;
    }),
  );
}
