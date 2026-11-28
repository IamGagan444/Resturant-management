import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "@rms/db";
import { AttendanceMarkInput, BusinessDate, Id, type AttendanceDay } from "@rms/contracts";
import { businessDate } from "@rms/domain";
import { audit } from "../lib/audit";
import { badRequest, parse } from "../lib/errors";
import { getHotel } from "../lib/hotel";
import { assertOwned } from "../lib/owned";
import { MANAGERS, staff } from "../lib/route";
import { attendanceDay } from "../services/presence";

const DAY_MS = 86_400_000;
/** Marks can be planned ahead (leave, week offs) up to this many days. */
const MAX_AHEAD_DAYS = 60;

/** A real calendar date (rejects 2026-02-31, which Date would roll into March). */
function checkDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw badRequest("BAD_DATE", "That date doesn't exist");
  return day;
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export async function attendanceRoutes(app: FastifyInstance) {
  /** Who was in on a business day (default: today), with first in, last seen, hours and any manager mark. */
  app.get(
    "/v1/admin/attendance",
    staff(MANAGERS, async (req, _reply, ctx): Promise<AttendanceDay> => {
      const hotel = await getHotel(ctx.hid);
      const today = businessDate(new Date(), hotel.timezone, hotel.dayStartsAt);
      const { day = today } = parse(z.object({ day: BusinessDate.optional() }), req.query);
      checkDay(day);
      if (daysBetween(today, day) > MAX_AHEAD_DAYS) throw badRequest("TOO_FAR", `Pick a day within ${MAX_AHEAD_DAYS} days`);
      return attendanceDay(hotel, day);
    }),
  );

  /** Set or clear a manager's mark (leave, week off, present, absent) for one person and day. */
  app.put(
    "/v1/admin/attendance/:staffId/:day",
    staff(MANAGERS, async (req, _reply, ctx) => {
      const { staffId, day } = parse(z.object({ staffId: Id, day: BusinessDate }), req.params);
      checkDay(day);
      const input = parse(AttendanceMarkInput, req.body);
      await assertOwned("staff", [staffId]);
      const hotel = await getHotel(ctx.hid);
      const today = businessDate(new Date(), hotel.timezone, hotel.dayStartsAt);
      if (daysBetween(today, day) > MAX_AHEAD_DAYS) throw badRequest("TOO_FAR", `Pick a day within ${MAX_AHEAD_DAYS} days`);
      if (input.kind === null) {
        await db.attendanceMark.deleteMany({ where: { staffId, day } });
      } else {
        const data = { kind: input.kind, note: input.note || null, markedById: ctx.sub };
        await db.attendanceMark.upsert({ where: { staffId_day: { staffId, day } }, create: { hotelId: ctx.hid, staffId, day, ...data }, update: data });
      }
      await audit(ctx.sub, "ATTENDANCE_MARKED", "Staff", staffId, { day, kind: input.kind, note: input.note ?? null });
      return { ok: true };
    }),
  );
}
