import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { unscopedDb, type StaffRole } from "@rms/db";
import { env } from "../env";
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

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const guestKey = new TextEncoder().encode(env.JWT_REFRESH_SECRET); // separate key: guest tokens can never pass as staff

async function sign(claims: object, key: Uint8Array, ttlSec: number): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(key);
}

export const signAccess = (c: AccessClaims) => sign(c, accessKey, ACCESS_TTL_SEC);
export const signGuest = (c: GuestClaims) => sign(c, guestKey, GUEST_TTL_SEC);

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessKey, { algorithms: ["HS256"] });
    if (payload.typ === "staff" || payload.typ === "platform") return payload as unknown as AccessClaims;
    return null;
  } catch {
    return null;
  }
}

export async function verifyGuestToken(token: string): Promise<GuestClaims | null> {
  try {
    const { payload } = await jwtVerify(token, guestKey, { algorithms: ["HS256"] });
    return payload.typ === "guest" ? (payload as unknown as GuestClaims) : null;
  } catch {
    return null;
  }
}

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export async function readAccess(req: FastifyRequest): Promise<AccessClaims> {
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

/** Issue access + refresh tokens (cookies) and persist the hashed refresh token. Returns the access token too. */
export async function issueSession(reply: FastifyReply, claims: AccessClaims): Promise<{ accessToken: string }> {
  const accessToken = await signAccess(claims);
  const refresh = randomToken();
  await unscopedDb.refreshToken.create({
    data: {
      subjectType: claims.typ === "platform" ? "PLATFORM" : "STAFF",
      subjectId: claims.sub,
      deviceId: claims.typ === "staff" ? claims.did : null,
      tokenHash: sha256(refresh),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
    },
  });
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
