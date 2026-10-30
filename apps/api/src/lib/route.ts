import type { FastifyReply, FastifyRequest } from "fastify";
import { db, withTenant, type StaffRole } from "@rms/db";
import { forbidden, unauthorized } from "./errors";
import { readAccess, readGuest, type GuestClaims, type PlatformClaims, type StaffClaims } from "./auth";
import { assertHotelOperational, getHotel } from "./hotel";

/**
 * Route guards. Every tenant handler runs inside withTenant(), so the Prisma extension
 * scopes all queries to the caller's hotel — a handler cannot forget it.
 */

export const MANAGERS: readonly StaffRole[] = ["OWNER", "MANAGER"];
export const FLOOR: readonly StaffRole[] = ["OWNER", "MANAGER", "WAITER"];
export const KITCHEN: readonly StaffRole[] = ["OWNER", "MANAGER", "COOK"];
export const CASH: readonly StaffRole[] = ["OWNER", "MANAGER", "CASHIER"];
export const ANY_STAFF: readonly StaffRole[] = ["OWNER", "MANAGER", "CASHIER", "COOK", "WAITER"];

type Handler<C> = (req: FastifyRequest, reply: FastifyReply, ctx: C) => Promise<unknown>;

export function staff(roles: readonly StaffRole[], handler: Handler<StaffClaims>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const claims = await readAccess(req);
    if (claims.typ !== "staff") throw forbidden();
    if (!roles.includes(claims.role)) throw forbidden();
    assertHotelOperational(await getHotel(claims.hid));
    return withTenant(claims.hid, () => handler(req, reply, claims));
  };
}

export function platform(handler: Handler<PlatformClaims>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const claims = await readAccess(req);
    if (claims.typ !== "platform") throw forbidden();
    return handler(req, reply, claims);
  };
}

/** Customer routes: valid guest token AND the session is still live. */
export function guest(handler: Handler<GuestClaims>) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const claims = await readGuest(req);
    assertHotelOperational(await getHotel(claims.hid));
    return withTenant(claims.hid, async () => {
      const session = await db.tableSession.findUnique({ where: { id: claims.ses }, select: { status: true } });
      if (!session || session.status === "CLOSED") throw unauthorized("This table session has ended. Scan the QR again.");
      return handler(req, reply, claims);
    });
  };
}

export const isManager = (role: StaffRole) => MANAGERS.includes(role);
