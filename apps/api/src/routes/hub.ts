import { createHmac } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SignJWT } from "jose";
import { db, unscopedDb, withTenant, type StaffRole } from "@rms/db";
import { HubPairInput, HubSyncInput, type HubPass, type HubSnapshot, type SyncResult } from "@rms/contracts";
import { env } from "../env";
import { audit } from "../lib/audit";
import { bearer } from "../lib/auth";
import { randomToken, sha256 } from "../lib/crypto";
import { parse, unauthorized } from "../lib/errors";
import { assertHotelOperational, getHotel, invalidateHotel } from "../lib/hotel";
import { ANY_STAFF, MANAGERS, staff } from "../lib/route";
import { runCommand } from "../services/commands";
import { assignmentsToday, boardTables, liveTickets } from "../services/floorData";
import { invalidateMenu, loadPublicMenu } from "../services/menu";
import { orderInclude, requestInclude, toOrderView, toRequestView } from "../services/views";

/**
 * Local hub (outage fallback). The hub is a small box on the restaurant LAN, paired like a device.
 *  - while online it pulls GET /v1/hub/snapshot every few seconds
 *  - during an outage staff devices talk to it with a hub pass and it queues their commands
 *  - when the internet is back it replays them through POST /v1/hub/sync (same idempotent commands)
 */

const PASS_TTL_SEC = 24 * 3600;

/** Per-hub key for device passes; derived, so pairing a new hub invalidates the old hub's passes. */
const passKey = (hubDeviceId: string) => createHmac("sha256", env.JWT_ACCESS_SECRET).update(`hub-pass:${hubDeviceId}`).digest("base64url");

async function activeHub(hotelId: string) {
  return unscopedDb.device.findFirst({ where: { hotelId, kind: "HUB", revokedAt: null }, orderBy: { createdAt: "desc" } });
}

/** Hub box auth: `Authorization: Bearer <hub token>` → its hotel's tenant context. */
function hubOnly(handler: (req: FastifyRequest, reply: FastifyReply, hub: { id: string; hotelId: string }) => Promise<unknown>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = bearer(req);
    const device = token ? await unscopedDb.device.findUnique({ where: { tokenHash: sha256(token) } }) : null;
    if (!device || device.kind !== "HUB" || device.revokedAt) throw unauthorized("Unknown hub");
    assertHotelOperational(await getHotel(device.hotelId));
    await unscopedDb.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return withTenant(device.hotelId, () => handler(req, reply, { id: device.id, hotelId: device.hotelId }));
  };
}

export async function hubRoutes(app: FastifyInstance) {
  /** Pair the hub: replaces any previous hub. The token is shown once; it goes into the hub's .env as HUB_TOKEN. */
  app.post(
    "/v1/admin/hub",
    staff(MANAGERS, async (req, reply, ctx) => {
      const input = parse(HubPairInput, req.body);
      const token = randomToken();
      const device = await db.$transaction(async (tx) => {
        await tx.device.updateMany({ where: { kind: "HUB", revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.hotel.update({ where: { id: ctx.hid }, data: { hubUrl: input.url } });
        return tx.device.create({ data: { hotelId: ctx.hid, name: input.name, kind: "HUB", tokenHash: sha256(token) } });
      });
      invalidateHotel(ctx.hid);
      await audit(ctx.sub, "HUB_PAIRED", "Device", device.id, { url: input.url });
      reply.status(201);
      return { deviceId: device.id, token, url: input.url, cloudUrl: env.API_URL };
    }),
  );

  app.delete(
    "/v1/admin/hub",
    staff(MANAGERS, async (_req, _reply, ctx) => {
      await db.device.updateMany({ where: { kind: "HUB", revokedAt: null }, data: { revokedAt: new Date() } });
      await db.hotel.update({ where: { id: ctx.hid }, data: { hubUrl: null } });
      invalidateHotel(ctx.hid);
      await audit(ctx.sub, "HUB_REMOVED", "Hotel", ctx.hid);
      return { ok: true };
    }),
  );

  app.get(
    "/v1/admin/hub",
    staff(MANAGERS, async (_req, _reply, ctx) => {
      const [hotel, hub] = await Promise.all([getHotel(ctx.hid), activeHub(ctx.hid)]);
      return { url: hotel.hubUrl, deviceId: hub?.id ?? null, lastSeenAt: hub?.lastSeenAt?.toISOString() ?? null };
    }),
  );

  /** Signed-in devices fetch this while online, so an outage needs no new login. */
  app.get(
    "/v1/s/hub/pass",
    staff(ANY_STAFF, async (_req, _reply, ctx): Promise<HubPass> => {
      const [hotel, hub] = await Promise.all([getHotel(ctx.hid), activeHub(ctx.hid)]);
      if (!hub || !hotel.hubUrl) return { hubUrl: null, hotelId: ctx.hid, pass: null, expiresAt: null };
      const exp = new Date(Date.now() + PASS_TTL_SEC * 1000);
      const pass = await new SignJWT({ typ: "hubpass", hid: ctx.hid, role: ctx.role, sid: ctx.sid })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(ctx.sub)
        .setIssuedAt()
        .setExpirationTime(Math.floor(exp.getTime() / 1000))
        .sign(new TextEncoder().encode(passKey(hub.id)));
      return { hubUrl: hotel.hubUrl, hotelId: ctx.hid, pass, expiresAt: exp.toISOString() };
    }),
  );

  /** Everything the kitchen and floor need to keep working on the LAN. */
  app.get(
    "/v1/hub/snapshot",
    hubOnly(async (_req, _reply, hub): Promise<HubSnapshot> => {
      const hotel = await getHotel(hub.hotelId);
      const [menu, stations, menuItems, staffRows, tables, assignments, orders, pending, requests] = await Promise.all([
        loadPublicMenu(hotel),
        db.station.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
        db.menuItem.findMany({
          where: { isActive: true },
          select: { id: true, name: true, isAvailable: true, stationId: true, categoryId: true },
          orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }],
        }),
        db.staff.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true, stationId: true }, orderBy: { name: "asc" } }),
        boardTables(),
        assignmentsToday(hotel),
        liveTickets(),
        db.order.findMany({ where: { status: "PENDING_CONFIRMATION", session: { status: { in: ["OPEN", "BILLING"] } } }, include: orderInclude }),
        db.serviceRequest.findMany({ where: { status: { not: "DONE" } }, include: requestInclude, orderBy: { createdAt: "asc" } }),
      ]);
      return {
        generatedAt: new Date().toISOString(),
        hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug, timezone: hotel.timezone },
        passKey: passKey(hub.id),
        menu,
        stations,
        menuItems,
        staff: staffRows.map((s) => ({ ...s, role: s.role as StaffRole })),
        tables,
        assignments,
        orders,
        pendingOrders: pending.map(toOrderView),
        requests: requests.map(toRequestView),
      };
    }),
  );

  /** Replay of commands staff made on the LAN during an outage, as the staff member who made each one. */
  app.post(
    "/v1/hub/sync",
    hubOnly(async (req, _reply, hub): Promise<SyncResult> => {
      const { commands } = parse(HubSyncInput, req.body);
      const staffIds = [...new Set(commands.map((c) => c.staffId))];
      const people = new Map((await db.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, role: true, isActive: true } })).map((p) => [p.id, p]));
      const results: SyncResult["results"] = [];
      for (const { staffId, ...q } of commands) {
        const who = people.get(staffId);
        if (!who) {
          results.push({ clientId: q.clientId, outcome: "REJECTED", reason: "Unknown staff member" });
          continue;
        }
        // a staff member removed during the outage still did the work; their actions stand
        results.push(await runCommand({ hid: hub.hotelId, staffId, role: who.role, deviceId: hub.id }, q));
      }
      invalidateMenu(hub.hotelId);
      return { results };
    }),
  );
}
