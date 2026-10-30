import { db, unscopedDb, withTenant, type Hotel } from "@rms/db";
import { rooms, type Cart, type JoinSessionInput, type SessionView, type TableLookup } from "@rms/contracts";
import { sum } from "@rms/domain";
import { AppError, isUniqueViolation, notFound } from "../lib/errors";
import { joinCode } from "../lib/crypto";
import { assertHotelOperational, getHotel } from "../lib/hotel";
import { emit } from "../realtime/io";
import { waiterRooms } from "./notify";
import { priceSelections } from "./menu";

const LIVE = { in: ["OPEN", "BILLING"] as ("OPEN" | "BILLING")[] };

/** Resolve a printed QR token to its hotel + table. Unscoped by necessity: the token is the tenant key. */
export async function resolveQr(qrToken: string) {
  const table = await unscopedDb.table.findUnique({ where: { qrToken } });
  if (!table || !table.isActive) throw new AppError(404, "QR_INVALID", "This QR code is no longer valid. Please ask the staff.");
  const hotel = await getHotel(table.hotelId);
  assertHotelOperational(hotel);
  return { table, hotel };
}

export async function lookupTable(qrToken: string, deviceId: string | undefined): Promise<TableLookup> {
  const { table, hotel } = await resolveQr(qrToken);
  return withTenant(hotel.id, async () => {
    const live = await db.tableSession.findFirst({ where: { tableId: table.id, status: LIVE }, select: { id: true } });
    const member =
      live && deviceId
        ? await db.sessionGuest.findUnique({ where: { sessionId_deviceId: { sessionId: live.id, deviceId } }, select: { id: true } })
        : null;
    return {
      hotel: { id: hotel.id, name: hotel.name, slug: hotel.slug },
      table: { id: table.id, label: table.label, status: table.status },
      hasOpenSession: Boolean(live),
      isMember: Boolean(member),
    };
  });
}

/**
 * Join (or open) the table's live session.
 *  - No live session → open one; this guest is host and sees the join code.
 *  - Live session, same device → rejoin silently.
 *  - Live session, new device → join code required (anti-prank: a photo of the QR isn't enough).
 * Concurrent first scans race on the partial unique index; the loser joins the winner's session.
 */
export async function joinSession(input: JoinSessionInput) {
  const { table, hotel } = await resolveQr(input.qrToken);
  return withTenant(hotel.id, async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const live = await db.tableSession.findFirst({ where: { tableId: table.id, status: LIVE } });
      if (live) {
        const existing = await db.sessionGuest.findUnique({
          where: { sessionId_deviceId: { sessionId: live.id, deviceId: input.deviceId } },
        });
        if (existing) return { hotel, sessionId: live.id, guestId: existing.id };
        if (!input.joinCode) throw new AppError(403, "JOIN_CODE_REQUIRED", "Ask your table for the 4-digit join code");
        if (input.joinCode !== live.joinCode) throw new AppError(403, "JOIN_CODE_INVALID", "That code doesn't match this table");
        const customerId = await upsertCustomer(hotel.id, input);
        const g = await db.sessionGuest.create({
          data: { hotelId: hotel.id, sessionId: live.id, deviceId: input.deviceId, displayName: input.name, customerId },
        });
        await db.tableSession.update({ where: { id: live.id }, data: { lastActivityAt: new Date() } });
        const guestEvent = { hotelId: hotel.id, sessionId: live.id, guest: { id: g.id, displayName: g.displayName, isHost: false } };
        emit("session:guest_joined", [rooms.session(live.id), ...(await waiterRooms(hotel.id, table.id))], guestEvent);
        return { hotel, sessionId: live.id, guestId: g.id };
      }
      try {
        const customerId = await upsertCustomer(hotel.id, input);
        const created = await db.$transaction(async (tx) => {
          const s = await tx.tableSession.create({ data: { hotelId: hotel.id, tableId: table.id, joinCode: joinCode() } });
          const g = await tx.sessionGuest.create({
            data: { hotelId: hotel.id, sessionId: s.id, deviceId: input.deviceId, displayName: input.name, customerId, isHost: true },
          });
          await tx.table.update({ where: { id: table.id }, data: { status: "OCCUPIED" } });
          return { s, g };
        });
        const to = [rooms.managers(hotel.id), ...(await waiterRooms(hotel.id, table.id))];
        emit("table:status_changed", to, { hotelId: hotel.id, tableId: table.id, status: "OCCUPIED" });
        emit("session:guest_joined", to, {
          hotelId: hotel.id,
          sessionId: created.s.id,
          guest: { id: created.g.id, displayName: created.g.displayName, isHost: true },
        });
        return { hotel, sessionId: created.s.id, guestId: created.g.id };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e; // someone else opened the session first → loop and join it
      }
    }
    throw new AppError(409, "SESSION_RACE", "Please try again");
  });
}

async function upsertCustomer(hotelId: string, input: JoinSessionInput): Promise<string | null> {
  if (!input.phone) return null;
  const c = await db.customer.upsert({
    where: { hotelId_phone: { hotelId, phone: input.phone } },
    create: { hotelId, phone: input.phone, name: input.name, visits: 1 },
    update: { name: input.name, visits: { increment: 1 } },
  });
  return c.id;
}

export async function cartView(hotel: Hotel, sessionId: string): Promise<Cart> {
  const rows = await db.cartItem.findMany({
    where: { sessionId },
    include: { guest: { select: { displayName: true } } },
    orderBy: { updatedAt: "asc" },
  });
  const priced = await priceSelections(hotel, rows);
  const items = rows.map((r, i) => {
    const p = priced[i];
    const ok = p?.ok === true;
    return {
      id: r.id,
      guestId: r.guestId,
      guestName: r.guest.displayName,
      itemId: r.itemId,
      name: p?.item?.name ?? "Unavailable item",
      variantId: r.variantId,
      variantName: ok ? p.line.variantName : null,
      addonIds: r.addonIds,
      addonNames: ok ? p.line.addons.map((a) => a.name) : [],
      quantity: r.quantity,
      note: r.note,
      unitPrice: ok ? p.line.unitPrice : 0,
      lineTotal: ok ? p.line.lineTotal : 0,
      isValid: ok,
    };
  });
  return { items, subtotal: sum(items.map((i) => i.lineTotal)) };
}

export async function sessionView(sessionId: string, guestId: string): Promise<SessionView> {
  const s = await db.tableSession.findUnique({
    where: { id: sessionId },
    include: { guests: { orderBy: { joinedAt: "asc" } }, table: { select: { label: true } } },
  });
  if (!s) throw notFound("Session");
  const me = s.guests.find((g) => g.id === guestId);
  if (!me) throw notFound("Guest");
  const hotel = await getHotel(s.hotelId);
  const guests = s.guests.map((g) => ({ id: g.id, displayName: g.displayName, isHost: g.isHost }));
  return {
    id: s.id,
    status: s.status,
    tableLabel: s.table.label,
    joinCode: me.isHost ? s.joinCode : null,
    isConfirmed: s.isConfirmed,
    me: { id: me.id, displayName: me.displayName, isHost: me.isHost },
    guests,
    cart: await cartView(hotel, s.id),
  };
}

export async function broadcastCart(hotel: Hotel, sessionId: string) {
  emit("cart:updated", [rooms.session(sessionId)], { hotelId: hotel.id, sessionId, cart: await cartView(hotel, sessionId) });
}
