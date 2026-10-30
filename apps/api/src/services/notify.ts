import { db } from "@rms/db";
import { rooms } from "@rms/contracts";
import { businessDay, getHotel } from "../lib/hotel";

/** Rooms of the waiter(s) assigned to a table today; all waiters if nobody is assigned. */
export async function waiterRooms(hotelId: string, tableId: string): Promise<string[]> {
  const { date } = businessDay(await getHotel(hotelId));
  const a = await db.tableAssignment.findMany({ where: { tableId, shiftDate: date }, select: { staffId: true } });
  return a.length ? a.map((x) => rooms.staff(hotelId, x.staffId)) : [rooms.waiters(hotelId)];
}
