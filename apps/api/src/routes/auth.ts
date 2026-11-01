import { randomInt } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { db, unscopedDb, type StaffRole } from "@rms/db";
import { DeviceClaimInput, DevicePairInput, LEAD_PIN_LENGTH, LoginInput, PinLoginInput, isLeadRole, type Me } from "@rms/contracts";
import { AppError, forbidden, notFound, parse, unauthorized } from "../lib/errors";
import { randomToken, sha256, verifySecret } from "../lib/crypto";
import {
  COOKIE,
  clearSession,
  issueSession,
  readAccess,
  setDeviceCookie,
  type AccessClaims,
  type StaffClaims,
} from "../lib/auth";
import { assertHotelOperational, getHotel } from "../lib/hotel";
import { MANAGERS, staff } from "../lib/route";
import { redis } from "../jobs/queue";

const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 5 * 60_000;

// Who can sign in with a PIN on each kind of shared device. The owner is only on a "Manager" device:
// a PIN glimpsed over a shoulder on a waiter phone must not open the whole business. On staff devices
// the owner signs in with email + password instead.
const DEVICE_ROLES: Record<string, StaffRole[]> = {
  KDS: ["COOK", "MANAGER"],
  WAITER: ["WAITER", "MANAGER"],
  POS: ["CASHIER", "MANAGER"],
  MANAGER: ["OWNER", "MANAGER", "CASHIER", "COOK", "WAITER"],
};

// Pairing codes: the owner creates one on their own phone and types it on the new device, so their
// password never touches a staff device. 6 digits, one use, 10 minutes.
const PAIR_CODE_TTL_SEC = 10 * 60;
const pairKey = (code: string) => `auth:pair-code:${code}`;
interface PairCodeData {
  hotelId: string;
  name: string;
  kind: DevicePairInput["kind"];
  stationId: string | null;
  by: string;
}

async function createDevice(reply: FastifyReply, hotelId: string, input: { name: string; kind: DevicePairInput["kind"]; stationId?: string | null }) {
  const token = randomToken();
  const device = await unscopedDb.device.create({
    data: { hotelId, name: input.name, kind: input.kind, stationId: input.stationId ?? null, tokenHash: sha256(token), lastSeenAt: new Date() },
  });
  setDeviceCookie(reply, token);
  return { id: device.id, name: device.name, kind: device.kind, stationId: device.stationId };
}

async function deviceFromCookie(token: string | undefined) {
  if (!token) return null;
  const d = await unscopedDb.device.findUnique({ where: { tokenHash: sha256(token) } });
  return d && !d.revokedAt ? d : null;
}

export async function authRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  /** Email + password: super admin, or hotel owner/manager on the web admin. */
  app.post("/v1/auth/login", strict, async (req, reply) => {
    const { email, password } = parse(LoginInput, req.body);
    const normalized = email.toLowerCase();
    const pu = await unscopedDb.platformUser.findUnique({ where: { email: normalized } });
    if (pu) {
      if (!(await verifySecret(pu.passwordHash, password))) throw unauthorized("Wrong email or password");
      await issueSession(reply, { typ: "platform", sub: pu.id, role: pu.role });
      return { ok: true, typ: "platform" };
    }
    const s = await unscopedDb.staff.findUnique({ where: { email: normalized } });
    if (!s || !s.passwordHash || !s.isActive || !MANAGERS.includes(s.role)) throw unauthorized("Wrong email or password");
    if (!(await verifySecret(s.passwordHash, password))) throw unauthorized("Wrong email or password");
    assertHotelOperational(await getHotel(s.hotelId));
    await issueSession(reply, { typ: "staff", sub: s.id, hid: s.hotelId, role: s.role, did: null, sid: null });
    return { ok: true, typ: "staff" };
  });

  /** A manager, signed in on the device itself, pairs it once. Staff then switch with PIN only. */
  app.post(
    "/v1/auth/devices/pair",
    staff(MANAGERS, async (req, reply, ctx) => {
      const input = parse(DevicePairInput, req.body);
      if (input.stationId && !(await db.station.findUnique({ where: { id: input.stationId } }))) throw notFound("Station");
      return createDevice(reply, ctx.hid, input);
    }),
  );

  /** A manager, on their own phone, makes a one-time code for another device. */
  app.post(
    "/v1/admin/devices/pair-code",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const input = parse(DevicePairInput, req.body);
      if (input.stationId && !(await db.station.findUnique({ where: { id: input.stationId } }))) throw notFound("Station");
      const data: PairCodeData = { hotelId: ctx.hid, name: input.name, kind: input.kind, stationId: input.stationId ?? null, by: ctx.sub };
      for (let i = 0; i < 5; i++) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        if (await redis.set(pairKey(code), JSON.stringify(data), "EX", PAIR_CODE_TTL_SEC, "NX")) {
          return { code, expiresAt: new Date(Date.now() + PAIR_CODE_TTL_SEC * 1000).toISOString() };
        }
      }
      throw new AppError(503, "TRY_AGAIN", "Couldn't make a code. Try again.");
    }),
  );

  /** The new device types the code: it is paired, nobody signs in on it. Strict limit: codes are short. */
  app.post("/v1/auth/devices/claim", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { code } = parse(DeviceClaimInput, req.body);
    const raw = await redis.getdel(pairKey(code));
    if (!raw) throw new AppError(400, "BAD_PAIR_CODE", "That code is wrong or has expired. Make a new one on the owner's phone.");
    const data = JSON.parse(raw) as PairCodeData;
    assertHotelOperational(await getHotel(data.hotelId));
    return createDevice(reply, data.hotelId, data);
  });

  /** Paired device: who can sign in here. */
  app.get("/v1/auth/device", async (req) => {
    const device = await deviceFromCookie(req.cookies[COOKIE.device]);
    if (!device) throw new AppError(401, "DEVICE_NOT_PAIRED", "This device isn't paired yet");
    const hotel = await getHotel(device.hotelId);
    const people = await unscopedDb.staff.findMany({
      where: { hotelId: device.hotelId, isActive: true, role: { in: DEVICE_ROLES[device.kind] ?? [] } },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    });
    return {
      device: { id: device.id, name: device.name, kind: device.kind, stationId: device.stationId },
      hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug },
      staff: people,
    };
  });

  /** Fast switch on a paired device: pick avatar, enter PIN. Locks for 5 min after 5 bad PINs. */
  // per IP, and a restaurant's devices share one: allow a shift change; the per-person PIN lockout stops guessing
  app.post("/v1/auth/pin", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req, reply) => {
    const device = await deviceFromCookie(req.cookies[COOKIE.device]);
    if (!device) throw new AppError(401, "DEVICE_NOT_PAIRED", "This device isn't paired yet");
    const { staffId, pin } = parse(PinLoginInput, req.body);
    const s = await unscopedDb.staff.findUnique({ where: { id: staffId } });
    if (!s || s.hotelId !== device.hotelId || !s.isActive) throw unauthorized("Wrong PIN");
    if (!(DEVICE_ROLES[device.kind] ?? []).includes(s.role)) throw forbidden("You can't sign in on this device");
    if (isLeadRole(s.role) && pin.length < LEAD_PIN_LENGTH)
      throw new AppError(400, "PIN_TOO_SHORT", "Owners and managers need a 6-digit PIN. Sign in with email and set a new one under Team.");
    if (s.lockedUntil && s.lockedUntil > new Date()) throw new AppError(423, "PIN_LOCKED", "Too many wrong PINs. Try again in a few minutes.");
    if (!(await verifySecret(s.pinHash, pin))) {
      const fails = s.pinFailedCount + 1;
      await unscopedDb.staff.update({
        where: { id: s.id },
        data: fails >= PIN_MAX_FAILS ? { pinFailedCount: 0, lockedUntil: new Date(Date.now() + PIN_LOCK_MS) } : { pinFailedCount: fails },
      });
      throw unauthorized("Wrong PIN");
    }
    assertHotelOperational(await getHotel(s.hotelId));
    await unscopedDb.staff.update({ where: { id: s.id }, data: { pinFailedCount: 0, lockedUntil: null } });
    await unscopedDb.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    const claims: StaffClaims = {
      typ: "staff",
      sub: s.id,
      hid: s.hotelId,
      role: s.role,
      did: device.id,
      sid: device.stationId ?? s.stationId ?? null,
    };
    const { accessToken } = await issueSession(reply, claims);
    return { ok: true, accessToken };
  });

  /** Rotate refresh token. Reuse of a rotated token revokes every session of that user (theft signal). */
  app.post("/v1/auth/refresh", async (req, reply) => {
    const raw = req.cookies[COOKIE.refresh];
    if (!raw) throw unauthorized();
    const rt = await unscopedDb.refreshToken.findUnique({ where: { tokenHash: sha256(raw) } });
    if (!rt || rt.expiresAt < new Date()) throw unauthorized();
    if (rt.revokedAt) {
      await unscopedDb.refreshToken.updateMany({
        where: { subjectType: rt.subjectType, subjectId: rt.subjectId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      clearSession(reply);
      throw unauthorized("Session expired");
    }
    let claims: AccessClaims;
    if (rt.subjectType === "PLATFORM") {
      const pu = await unscopedDb.platformUser.findUnique({ where: { id: rt.subjectId } });
      if (!pu) throw unauthorized();
      claims = { typ: "platform", sub: pu.id, role: pu.role };
    } else {
      const s = await unscopedDb.staff.findUnique({ where: { id: rt.subjectId } });
      if (!s || !s.isActive) throw unauthorized();
      const device = rt.deviceId ? await unscopedDb.device.findUnique({ where: { id: rt.deviceId } }) : null;
      if (rt.deviceId && (!device || device.revokedAt)) throw unauthorized("Device was removed");
      assertHotelOperational(await getHotel(s.hotelId));
      claims = { typ: "staff", sub: s.id, hid: s.hotelId, role: s.role, did: device?.id ?? null, sid: device?.stationId ?? s.stationId ?? null };
    }
    await unscopedDb.refreshToken.update({ where: { id: rt.id }, data: { revokedAt: new Date() } });
    const { accessToken } = await issueSession(reply, claims);
    return { ok: true, accessToken };
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const raw = req.cookies[COOKIE.refresh];
    if (raw) await unscopedDb.refreshToken.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
    clearSession(reply);
    return { ok: true };
  });

  app.get("/v1/auth/me", async (req): Promise<Me> => {
    const c = await readAccess(req);
    if (c.typ === "platform") {
      const pu = await unscopedDb.platformUser.findUnique({ where: { id: c.sub } });
      if (!pu) throw unauthorized();
      return { typ: "platform", id: pu.id, name: pu.name, email: pu.email, role: pu.role };
    }
    const s = await unscopedDb.staff.findUnique({ where: { id: c.sub } });
    if (!s || !s.isActive) throw forbidden();
    const hotel = await getHotel(s.hotelId);
    return {
      typ: "staff",
      id: s.id,
      name: s.name,
      role: s.role,
      hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug },
      deviceId: c.did,
      stationId: c.sid,
    };
  });
}
