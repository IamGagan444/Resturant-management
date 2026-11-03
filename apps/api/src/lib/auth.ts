import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { unscopedDb, type StaffRole } from "@rms/db";
import { env } from "../env";
import { redis } from "../jobs/queue";
import { unauthorized } from "./errors";
import { randomToken, sha256 } from "./crypto";

/**
 * Tokens
 *   rms_at     short-lived access JWT (staff / platform)          httpOnly, 15 min
 *   rms_rt     opaque refresh token, rotated on every use          httpOnly, 30 days, path /v1/auth
 *   rms_dev    opaque device token from pairing                    httpOnly, 1 year
 *   rms_guest  customer guest JWT bound to one table session       httpOnly, 12 h
 * `Authorization: Bearer <access>` is also accepted (tests, sockets).
 */

export const COOKIE = { access: "rms_at", refresh: "rms_rt", device: "rms_dev", guest: "rms_guest" } as const;

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 3600;
const GUEST_TTL_SEC = 12 * 3600;
const DEVICE_TTL_SEC = 365 * 24 * 3600;

export interface StaffClaims {
  typ: "staff";
  sub: string;
  hid: string;
  role: StaffRole;
  did: string | null;
  sid: string | null; // station (KDS)
}
export interface PlatformClaims {
  typ: "platform";
  sub: string;
  role: string;
}
export interface GuestClaims {
  typ: "guest";
  sub: string; // guest id
  hid: string;
  ses: string; // session id
}
export type AccessClaims = StaffClaims | PlatformClaims;
/** What a verified access token carries besides the claims: `rid` = the sign-in (refresh token row) it belongs to. */
export type VerifiedAccess = AccessClaims & { rid?: string };

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const guestKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET); // separate key: guest tokens can never pass as staff

async function sign(claims: object, key: Uint8Array, ttlSec: number): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(key);
}

/** Only the claims, never a previous token's iat/exp/rid (callers may pass a verified payload back in). */
function claimsOnly(c: AccessClaims): AccessClaims {
  return c.typ === "platform"
    ? { typ: "platform", sub: c.sub, role: c.role }
    : { typ: "staff", sub: c.sub, hid: c.hid, role: c.role, did: c.did, sid: c.sid };
}

// `ims`: issue time in ms, so a forced sign-out can tell apart tokens made in the same second.
// `rid`: the sign-in this token belongs to, so signing out one browser ends its access token too.
export const signAccess = (c: AccessClaims, rid?: string) =>
  sign({ ...claimsOnly(c), ims: Date.now(), ...(rid && { rid }) }, accessKey, ACCESS_TTL_SEC);
export const signGuest = (c: GuestClaims) => sign(c, guestKey, GUEST_TTL_SEC);

export async function verifyAccessToken(token: string): Promise<VerifiedAccess | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey, { algorithms: ["HS256"] });
    if (payload.typ !== "staff" && payload.typ !== "platform") return null;
    const rid = typeof payload.rid === "string" ? payload.rid : undefined;
    const { cut, sessionEnded } = await revocationState(String(payload.sub), rid);
    const issuedMs = typeof payload.ims === "number" ? payload.ims : (payload.iat ?? 0) * 1000;
    if (sessionEnded || (cut && issuedMs <= cut)) return null;
    return payload as unknown as VerifiedAccess;
  } catch {
    return null;
  }
}

/**
 * Revocation. Access tokens are stateless for 15 min, so two short-lived Redis marks make "sign out now" immediate:
 *  - per person (forceSignOut): every token issued before the cut-off stops working — all their devices;
 *  - per sign-in (endSession): only tokens of that one browser/device (logout, "sign out this session").
 * Both expire with the longest-lived access token, after which the revoked refresh token has done the job.
 */
const cutKey = (sub: string) => `auth:signed-out:${sub}`;
const endedKey = (rid: string) => `auth:session-ended:${rid}`;
const MARK_TTL_SEC = ACCESS_TTL_SEC + 60;

export async function forceSignOut(subjectId: string): Promise<void> {
  await redis.set(cutKey(subjectId), String(Date.now()), "EX", MARK_TTL_SEC);
}

export async function endSession(refreshTokenId: string): Promise<void> {
  await redis.set(endedKey(refreshTokenId), "1", "EX", MARK_TTL_SEC);
}

async function revocationState(sub: string, rid: string | undefined): Promise<{ cut: number | null; sessionEnded: boolean }> {
  // Redis trouble must not lock everyone out: give up after a moment and trust the token (it expires in ≤15 min).
  const keys = rid ? [cutKey(sub), endedKey(rid)] : [cutKey(sub)];
  const v = await Promise.race([redis.mget(...keys).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 250))]);
  return { cut: v?.[0] ? Number(v[0]) : null, sessionEnded: Boolean(v?.[1]) };
}

export async function verifyGuestToken(token: string): Promise<GuestClaims | null> {
  try {
    const { payload } = await jwtVerify(token, guestKey, { algorithms: ["HS256"] });
    return payload.typ === "guest" ? (payload as unknown as GuestClaims) : null;
  } catch {
    return null;
  }
}

/**
 * Who a request counts against for rate limiting. A restaurant's kitchen screen, waiter phones and guests
 * all share one Wi-Fi (one public IP), so limiting by IP alone would throttle a busy restaurant.
 * Signed-in staff and seated guests get their own budget; only anonymous requests are counted per IP.
 * Tokens must verify, so a made-up token can't buy a fresh budget.
 */
export async function rateLimitKey(req: FastifyRequest): Promise<string> {
  const access = bearer(req) ?? req.cookies?.[COOKIE.access];
  if (access) {
    const p = await jwtVerify(access, accessKey, { algorithms: ["HS256"] }).catch(() => null);
    if (p?.payload.sub) return `user:${p.payload.sub}`;
  }
  const guest = req.headers["x-guest-token"] ?? req.cookies?.[COOKIE.guest];
  if (typeof guest === "string") {
    const p = await jwtVerify(guest, guestKey, { algorithms: ["HS256"] }).catch(() => null);
    if (p?.payload.sub) return `guest:${p.payload.sub}`;
  }
  return `ip:${req.ip}`;
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export async function readAccess(req: FastifyRequest): Promise<VerifiedAccess> {
  const token = bearer(req) ?? req.cookies[COOKIE.access];
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) throw unauthorized();
  return claims;
}

export async function readGuest(req: FastifyRequest): Promise<GuestClaims> {
  const token = req.headers["x-guest-token"] ?? req.cookies[COOKIE.guest];
  const claims = typeof token === "string" ? await verifyGuestToken(token) : null;
  if (!claims) throw unauthorized("Scan the table QR to start");
  return claims;
}

const cookieBase = () => ({ httpOnly: true, sameSite: "lax" as const, secure: env.COOKIE_SECURE, path: "/" });

export async function setGuestCookie(reply: FastifyReply, c: GuestClaims): Promise<string> {
  const token = await signGuest(c);
  reply.setCookie(COOKIE.guest, token, { ...cookieBase(), maxAge: GUEST_TTL_SEC });
  return token;
}

export function setDeviceCookie(reply: FastifyReply, token: string) {
  reply.setCookie(COOKIE.device, token, { ...cookieBase(), maxAge: DEVICE_TTL_SEC });
}

/**
 * Issue access + refresh tokens (cookies) and persist the hashed refresh token. Returns the access token too.
 * `familyId` names the sign-in across refresh rotations (pass the old token's on refresh); access tokens carry it as `rid`.
 */
export async function issueSession(reply: FastifyReply, claims: AccessClaims, familyId: string = randomUUID()): Promise<{ accessToken: string }> {
  const refresh = randomToken();
  await unscopedDb.refreshToken.create({
    data: {
      familyId,
      subjectType: claims.typ === "platform" ? "PLATFORM" : "STAFF",
      subjectId: claims.sub,
      deviceId: claims.typ === "staff" ? claims.did : null,
      tokenHash: sha256(refresh),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
      userAgent: reply.request.headers["user-agent"]?.slice(0, 300) ?? null,
      ip: reply.request.ip ?? null,
    },
  });
  const accessToken = await signAccess(claims, familyId);
  reply.setCookie(COOKIE.access, accessToken, { ...cookieBase(), maxAge: ACCESS_TTL_SEC });
  reply.setCookie(COOKIE.refresh, refresh, { ...cookieBase(), path: "/v1/auth", maxAge: REFRESH_TTL_SEC });
  return { accessToken };
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE.access, { path: "/" });
  reply.clearCookie(COOKIE.refresh, { path: "/v1/auth" });
}

export async function revokeAllFor(subjectType: "PLATFORM" | "STAFF", subjectId: string) {
  await unscopedDb.refreshToken.updateMany({
    where: { subjectType, subjectId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
