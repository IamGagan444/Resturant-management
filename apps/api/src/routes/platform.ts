import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { unscopedDb, type HotelStatus, type Prisma } from "@rms/db";
import { CreateHotelInput, Id, PlanInput, ResetPasswordInput, UpdateHotelInput, type PlatformHotel, type PlatformOverview, type PlatformSession } from "@rms/contracts";
import { conflict, notFound, parse } from "../lib/errors";
import { hashSecret } from "../lib/crypto";
import { forceSignOut } from "../lib/auth";
import { invalidateHotel } from "../lib/hotel";
import { platform } from "../lib/route";

const IdParam = z.object({ id: Id });
const SessionsQuery = z.object({ hotelId: Id.optional() });
const DAY = 24 * 3600_000;

/** Revoke every refresh token of these staff and cut their access tokens: they are signed out everywhere, now. */
async function signOutStaff(staffIds: string[]) {
  if (!staffIds.length) return 0;
  const r = await unscopedDb.refreshToken.updateMany({
    where: { subjectType: "STAFF", subjectId: { in: staffIds }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await Promise.all(staffIds.map(forceSignOut));
  return r.count;
}

/** People (not tokens) with at least one live sign-in; tokens of deleted staff don't count. */
async function signedInPeople() {
  const live = await unscopedDb.refreshToken.findMany({
    where: { subjectType: "STAFF", revokedAt: null, expiresAt: { gt: new Date() } },
    select: { subjectId: true },
    distinct: ["subjectId"],
  });
  return unscopedDb.staff.count({ where: { id: { in: live.map((t) => t.subjectId) } } });
}

/** Super admin. Operates across tenants, so it uses the unscoped client deliberately. */
export async function platformRoutes(app: FastifyInstance) {
  app.get(
    "/v1/platform/overview",
    platform(async (): Promise<PlatformOverview> => {
      const now = Date.now();
      const [statusCounts, newLast30d, ordersLast24h, ordersLast7d, liveSessions, staffSignedIn, failedPayments, failedSyncs, trials, top, recent] =
        await Promise.all([
          unscopedDb.hotel.groupBy({ by: ["status"], _count: { _all: true } }),
          unscopedDb.hotel.count({ where: { createdAt: { gte: new Date(now - 30 * DAY) } } }),
          unscopedDb.order.count({ where: { placedAt: { gte: new Date(now - DAY) } } }),
          unscopedDb.order.count({ where: { placedAt: { gte: new Date(now - 7 * DAY) } } }),
          unscopedDb.tableSession.count({ where: { status: { in: ["OPEN", "BILLING"] } } }),
          signedInPeople(),
          unscopedDb.payment.count({ where: { status: "FAILED", createdAt: { gte: new Date(now - DAY) } } }),
          unscopedDb.syncRejection.count({ where: { createdAt: { gte: new Date(now - DAY) } } }),
          unscopedDb.hotel.findMany({
            where: { status: "TRIAL", trialEndsAt: { lte: new Date(now + 7 * DAY) } },
            orderBy: { trialEndsAt: "asc" },
            take: 8,
            select: { id: true, name: true, trialEndsAt: true },
          }),
          unscopedDb.order.groupBy({
            by: ["hotelId"],
            where: { placedAt: { gte: new Date(now - 7 * DAY) } },
            _count: { _all: true },
            orderBy: { _count: { hotelId: "desc" } },
            take: 5,
          }),
          unscopedDb.hotel.findMany({ orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, status: true, createdAt: true } }),
        ]);
      const names = new Map(
        (await unscopedDb.hotel.findMany({ where: { id: { in: top.map((t) => t.hotelId) } }, select: { id: true, name: true } })).map((h) => [h.id, h.name]),
      );
      const byStatus: Record<HotelStatus, number> = { TRIAL: 0, ACTIVE: 0, SUSPENDED: 0, CANCELLED: 0 };
      for (const s of statusCounts) byStatus[s.status] = s._count._all;
      return {
        hotels: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus, newLast30d },
        activity: { ordersLast24h, ordersLast7d, liveSessions, staffSignedIn },
        problems: { failedPaymentsLast24h: failedPayments, failedSyncsLast24h: failedSyncs },
        trialsEndingSoon: trials.map((t) => ({ id: t.id, name: t.name, trialEndsAt: t.trialEndsAt?.toISOString() ?? "" })),
        topHotels: top.map((t) => ({ id: t.hotelId, name: names.get(t.hotelId) ?? "?", orders: t._count._all })),
        recentHotels: recent.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
      };
    }),
  );

  app.get(
    "/v1/platform/hotels",
    platform(async (): Promise<PlatformHotel[]> => {
      const since = new Date(Date.now() - 7 * DAY);
      const [hotels, orders] = await Promise.all([
        unscopedDb.hotel.findMany({
          orderBy: { createdAt: "desc" },
          include: {
            plan: { select: { id: true, name: true } },
            staff: { where: { role: "OWNER" }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true, name: true, email: true, phone: true } },
            _count: { select: { tables: { where: { isActive: true } }, staff: { where: { isActive: true } } } },
          },
        }),
        unscopedDb.order.groupBy({ by: ["hotelId"], where: { placedAt: { gte: since } }, _count: { _all: true } }),
      ]);
      const ordersBy = new Map(orders.map((o) => [o.hotelId, o._count._all]));
      return hotels.map((h) => ({
        id: h.id,
        name: h.name,
        slug: h.slug,
        status: h.status,
        phone: h.phone,
        address: h.address,
        gstin: h.gstin,
        plan: h.plan,
        trialEndsAt: h.trialEndsAt?.toISOString() ?? null,
        owner: h.staff[0] ?? null,
        tables: h._count.tables,
        staff: h._count.staff,
        ordersLast7d: ordersBy.get(h.id) ?? 0,
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
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.gstin !== undefined && { gstin: input.gstin }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.planId !== undefined && { planId: input.planId }),
        ...(input.trialEndsAt !== undefined && { trialEndsAt: input.trialEndsAt ? new Date(input.trialEndsAt) : null }),
        ...(input.featureOverrides !== undefined && { featureOverrides: input.featureOverrides ?? undefined }),
      };
      if (!(await unscopedDb.hotel.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Hotel");
      const h = await unscopedDb.hotel.update({ where: { id }, data });
      invalidateHotel(id); // suspending blocks the staff on their next request ("restaurant suspended")
      return { id: h.id, status: h.status };
    }),
  );

  /** Permanently removes the restaurant and everything in it (menu, orders, bills). The UI asks to type the name first. */
  app.delete(
    "/v1/platform/hotels/:id",
    platform(async (req) => {
      const { id } = parse(IdParam, req.params);
      const staff = await unscopedDb.staff.findMany({ where: { hotelId: id }, select: { id: true } });
      const r = await unscopedDb.hotel.deleteMany({ where: { id } });
      if (!r.count) throw notFound("Hotel");
      await signOutStaff(staff.map((s) => s.id));
      await unscopedDb.refreshToken.deleteMany({ where: { subjectType: "STAFF", subjectId: { in: staff.map((s) => s.id) } } });
      invalidateHotel(id);
      return { ok: true };
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
      const since = new Date(Date.now() - DAY);
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

  // ── Sessions: who from each restaurant is signed in, and where ──

  /** Active sign-ins of owners and managers (web) and of anyone on a paired device. */
  app.get(
    "/v1/platform/sessions",
    platform(async (req): Promise<PlatformSession[]> => {
      const { hotelId } = parse(SessionsQuery, req.query);
      const people = await unscopedDb.staff.findMany({
        where: { ...(hotelId && { hotelId }) },
        select: { id: true, name: true, role: true, email: true, hotel: { select: { id: true, name: true } } },
      });
      const byId = new Map(people.map((p) => [p.id, p]));
      const tokens = await unscopedDb.refreshToken.findMany({
        where: { subjectType: "STAFF", subjectId: { in: [...byId.keys()] }, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      const deviceIds = [...new Set(tokens.flatMap((t) => (t.deviceId ? [t.deviceId] : [])))];
      const devices = new Map(
        (await unscopedDb.device.findMany({ where: { id: { in: deviceIds } }, select: { id: true, name: true } })).map((d) => [d.id, d.name]),
      );
      return tokens.flatMap((t) => {
        const p = byId.get(t.subjectId);
        if (!p) return [];
        return [
          {
            id: t.id,
            person: { id: p.id, name: p.name, role: p.role, email: p.email },
            hotel: p.hotel,
            device: t.deviceId ? (devices.get(t.deviceId) ?? "Removed device") : null,
            userAgent: t.userAgent,
            ip: t.ip,
            lastActiveAt: t.createdAt.toISOString(),
            expiresAt: t.expiresAt.toISOString(),
          },
        ];
      });
    }),
  );

  /** Sign out one browser/device. Its access token stops working at once; the person's other sign-ins keep going. */
  app.delete(
    "/v1/platform/sessions/:id",
    platform(async (req) => {
      const { id } = parse(IdParam, req.params);
      const t = await unscopedDb.refreshToken.findUnique({ where: { id } });
      if (!t || t.subjectType !== "STAFF") throw notFound("Session");
      await unscopedDb.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
      await forceSignOut(t.subjectId);
      return { ok: true };
    }),
  );

  app.post(
    "/v1/platform/staff/:id/sign-out",
    platform(async (req) => {
      const { id } = parse(IdParam, req.params);
      if (!(await unscopedDb.staff.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Person");
      return { ok: true, sessions: await signOutStaff([id]) };
    }),
  );

  /** New password for an owner/manager who is locked out. Signs them out everywhere. */
  app.post(
    "/v1/platform/staff/:id/password",
    platform(async (req) => {
      const { id } = parse(IdParam, req.params);
      const { password } = parse(ResetPasswordInput, req.body);
      const s = await unscopedDb.staff.findUnique({ where: { id } });
      if (!s) throw notFound("Person");
      if (!s.email) throw conflict("NO_EMAIL_LOGIN", "This person signs in with a PIN only");
      await unscopedDb.staff.update({ where: { id }, data: { passwordHash: await hashSecret(password) } });
      await signOutStaff([id]);
      return { ok: true };
    }),
  );
}
