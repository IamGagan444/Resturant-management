import { unscopedDb, type Hotel } from "@rms/db";
import { businessDate } from "@rms/domain";
import { AppError, notFound } from "./errors";

/**
 * Short-lived in-process cache of hotel settings. Hot paths (every staff request, every order)
 * need status / timezone / flags; settings change rarely. PATCH /admin/hotel calls invalidateHotel().
 * With several API instances, other instances see changes within TTL.
 */
const TTL_MS = 30_000;
const cache = new Map<string, { hotel: Hotel; exp: number }>();

export async function getHotel(hotelId: string): Promise<Hotel> {
  const hit = cache.get(hotelId);
  if (hit && hit.exp > Date.now()) return hit.hotel;
  const hotel = await unscopedDb.hotel.findUnique({ where: { id: hotelId } });
  if (!hotel) throw notFound("Hotel");
  cache.set(hotelId, { hotel, exp: Date.now() + TTL_MS });
  return hotel;
}

export function invalidateHotel(hotelId: string) {
  cache.delete(hotelId);
}

export function assertHotelOperational(hotel: Hotel) {
  if (hotel.status === "SUSPENDED" || hotel.status === "CANCELLED") {
    throw new AppError(403, "HOTEL_SUSPENDED", "This restaurant is not accepting orders right now");
  }
  if (hotel.status === "TRIAL" && hotel.trialEndsAt && hotel.trialEndsAt < new Date()) {
    throw new AppError(403, "TRIAL_ENDED", "Trial has ended");
  }
}

/** Today's business date as a Date at UTC midnight (matches @db.Date columns). */
export function businessDay(hotel: Hotel, now = new Date()): { key: string; date: Date } {
  const key = businessDate(now, hotel.timezone, hotel.dayStartsAt);
  return { key, date: new Date(`${key}T00:00:00Z`) };
}
