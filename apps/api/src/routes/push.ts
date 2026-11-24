import type { FastifyInstance } from "fastify";
import { db, unscopedDb } from "@rms/db";
import { PushEndpointInput, PushPauseInput, PushSubscribeInput, type PushState } from "@rms/contracts";
import { notFound, parse, unauthorized } from "../lib/errors";
import type { VerifiedAccess } from "../lib/auth";
import { pushPublicKey } from "../lib/push";
import { ANY_STAFF, staff } from "../lib/route";
import { scheduleTestAlert } from "../jobs/queue";

const MAX_PER_PERSON = 10;

/** Phone alerts: each browser subscribes itself for whoever is signed in on it. */
export async function pushRoutes(app: FastifyInstance) {
  app.get("/v1/s/push/key", staff(ANY_STAFF, async () => ({ publicKey: pushPublicKey })));

  /** Sent on every app start, so a shared phone always rings the person signed in now. A new sign-in is back on duty. */
  app.post(
    "/v1/s/push",
    staff(ANY_STAFF, async (req, _reply, ctx): Promise<PushState> => {
      const { endpoint, keys } = parse(PushSubscribeInput, req.body);
      const familyId = (ctx as VerifiedAccess).rid;
      if (!familyId) throw unauthorized();
      const owner = { hotelId: ctx.hid, staffId: ctx.sub, familyId, deviceId: ctx.did };
      // unscoped: the same browser may have been used at another restaurant before. The address is a secret only that browser has.
      const before = await unscopedDb.pushSubscription.findUnique({ where: { endpoint }, select: { staffId: true, familyId: true, pausedAt: true } });
      const same = before?.staffId === ctx.sub && before.familyId === familyId;
      const s = await unscopedDb.pushSubscription.upsert({
        where: { endpoint },
        create: { ...owner, endpoint, ...keys },
        update: { ...owner, ...keys, ...(same ? {} : { pausedAt: null }) },
      });
      const extra = await db.pushSubscription.findMany({ where: { staffId: ctx.sub }, orderBy: { createdAt: "desc" }, skip: MAX_PER_PERSON, select: { id: true } });
      if (extra.length) await db.pushSubscription.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
      return { paused: s.pausedAt !== null };
    }),
  );

  app.post(
    "/v1/s/push/pause",
    staff(ANY_STAFF, async (req, _reply, ctx): Promise<PushState> => {
      const { endpoint, paused } = parse(PushPauseInput, req.body);
      const r = await db.pushSubscription.updateMany({ where: { endpoint, staffId: ctx.sub }, data: { pausedAt: paused ? new Date() : null } });
      if (!r.count) throw notFound("Alert subscription");
      return { paused };
    }),
  );

  app.post(
    "/v1/s/push/test",
    { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } },
    staff(ANY_STAFF, async (req, _reply, ctx) => {
      const { endpoint } = parse(PushEndpointInput, req.body);
      const s = await db.pushSubscription.findFirst({ where: { endpoint, staffId: ctx.sub }, select: { id: true } });
      if (!s) throw notFound("Alert subscription");
      await scheduleTestAlert(ctx.hid, s.id);
      return { ok: true };
    }),
  );
}
