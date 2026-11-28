import { db, withTenant, type Hotel } from "@rms/db";
import type { AttendanceDay, AttendanceRow } from "@rms/contracts";
import { PRESENCE, attendanceCounts, businessDate, businessDayRange, presenceStep, summarizeDay, type AttendanceStatus, type PresenceSpan } from "@rms/domain";

/**
 * Staff presence: the write side of attendance (the algorithm and its reasoning are in
 * packages/domain/src/attendance.ts).
 *
 * Every authenticated staff request (the screens poll every 15–30 s while open) and every sign-in calls
 * touchPresence. Per person, at most one write a minute; each write either moves the latest span's lastSeenAt or
 * opens a new span after a silence longer than PRESENCE.GAP_MS. A per-person advisory lock makes that
 * read-then-write atomic, so two devices pinging at the same instant can't open two spans (and if anything ever
 * does produce overlapping spans, the read side merges them, so time is never counted twice).
 *
 * Attendance must never break real work: callers use recordPresence, which swallows and logs errors.
 */

/** staffId → last write (ms) in this API process. A second process just writes a little more often: harmless. */
const lastWrite = new Map<string, number>();
const MAX_TRACKED = 50_000;

export async function touchPresence(hotelId: string, staffId: string, deviceId: string | null, opts: { force?: boolean; now?: number } = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  const prev = lastWrite.get(staffId);
  if (!opts.force && prev !== undefined && now - prev >= 0 && now - prev < PRESENCE.MIN_WRITE_MS) return;
  if (lastWrite.size >= MAX_TRACKED) lastWrite.clear();
  lastWrite.set(staffId, now);

  await withTenant(hotelId, () =>
    db.$transaction(async (tx) => {
      // serialise this person's pings (transaction-scoped: released on commit / rollback, never leaks)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`presence:${staffId}`}))`;
      const last = await tx.staffPresence.findFirst({
        where: { staffId },
        orderBy: { lastSeenAt: "desc" },
        select: { id: true, lastSeenAt: true, endedAt: true },
      });
      const step = presenceStep(last && { lastSeenAt: last.lastSeenAt.getTime(), endedAt: last.endedAt?.getTime() ?? null }, now);
      if (step === "extend" && last) {
        // never move lastSeenAt backwards (an out-of-order ping is already inside the span)
        if (now > last.lastSeenAt.getTime()) await tx.staffPresence.update({ where: { id: last.id }, data: { lastSeenAt: new Date(now) } });
        return;
      }
      await tx.staffPresence.create({ data: { hotelId, staffId, deviceId, startedAt: new Date(now), lastSeenAt: new Date(now) } });
    }),
  );
}

/** Signed out: close the open span now, so the person stops showing "on duty" straight away. */
export async function endPresence(hotelId: string, staffId: string, opts: { now?: number } = {}): Promise<void> {
  const now = opts.now ?? Date.now();
  // a poll already in flight when they signed out must not reopen the span; a PIN sign-in forces past this
  lastWrite.set(staffId, now);
  await withTenant(hotelId, () =>
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`presence:${staffId}`}))`;
      const last = await tx.staffPresence.findFirst({ where: { staffId }, orderBy: { lastSeenAt: "desc" }, select: { id: true, lastSeenAt: true, endedAt: true } });
      if (!last || last.endedAt || now - last.lastSeenAt.getTime() > PRESENCE.GAP_MS) return; // nothing open
      const at = new Date(Math.max(now, last.lastSeenAt.getTime()));
      await tx.staffPresence.update({ where: { id: last.id }, data: { lastSeenAt: at, endedAt: at } });
    }),
  );
}

type Log = { warn: (obj: unknown, msg?: string) => void };

/** Fire-and-forget wrappers: attendance trouble is logged, never surfaced to the person working. */
export function recordPresence(log: Log, hotelId: string, staffId: string, deviceId: string | null, opts: { force?: boolean } = {}): void {
  touchPresence(hotelId, staffId, deviceId, opts).catch((err) => log.warn({ err, staffId }, "presence write failed"));
}
export function recordSignOut(log: Log, hotelId: string, staffId: string): void {
  endPresence(hotelId, staffId).catch((err) => log.warn({ err, staffId }, "presence end failed"));
}

/** Test hook: forget the per-process throttle. */
export const resetPresenceThrottle = () => lastWrite.clear();

const ORDER: Record<AttendanceStatus, number> = { ON_DUTY: 0, PRESENT: 1, NOT_IN: 2, LEAVE: 3, WEEK_OFF: 4, ABSENT: 5 };

/** Everyone's attendance for one business day ("YYYY-MM-DD"). Must run inside withTenant(). */
export async function attendanceDay(hotel: Pick<Hotel, "timezone" | "dayStartsAt">, day: string, now = Date.now()): Promise<AttendanceDay> {
  const { from, to } = businessDayRange(day, hotel.timezone, hotel.dayStartsAt);
  const [everyone, rows, marks] = await Promise.all([
    db.staff.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true, station: { select: { name: true } } } }),
    // every span touching the day: ends on/after its start (index hotelId, lastSeenAt) and starts before its end
    db.staffPresence.findMany({ where: { lastSeenAt: { gte: from }, startedAt: { lt: to } }, select: { staffId: true, startedAt: true, lastSeenAt: true, endedAt: true } }),
    db.attendanceMark.findMany({ where: { day } }),
  ]);
  const spansBy = new Map<string, PresenceSpan[]>();
  for (const r of rows) {
    const end = Math.max(r.lastSeenAt.getTime(), r.endedAt?.getTime() ?? 0);
    const list = spansBy.get(r.staffId) ?? [];
    list.push({ start: r.startedAt.getTime(), end, ended: r.endedAt !== null });
    spansBy.set(r.staffId, list);
  }
  const names = new Map(everyone.map((p) => [p.id, p.name])); // includes owners, who mark others
  // owners run the place rather than clock in; everyone else, including managers, is listed
  const people = everyone.filter((p) => p.role !== "OWNER");
  const markBy = new Map(marks.map((m) => [m.staffId, m]));

  const out: AttendanceRow[] = people.map((p) => {
    const mark = markBy.get(p.id) ?? null;
    const d = summarizeDay({ spans: spansBy.get(p.id) ?? [], from: from.getTime(), to: to.getTime(), now, mark: mark?.kind ?? null });
    const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
    return {
      staff: { id: p.id, name: p.name, role: p.role, station: p.station?.name ?? null },
      status: d.status,
      observed: d.observed,
      conflict: d.conflict,
      mark: mark ? { kind: mark.kind, note: mark.note, by: mark.markedById ? (names.get(mark.markedById) ?? null) : null } : null,
      firstIn: iso(d.firstIn),
      lastSeen: iso(d.lastSeen),
      workedMin: Math.floor(d.workedMs / 60_000),
      spans: d.spans.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString() })),
    };
  });
  out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.staff.name.localeCompare(b.staff.name));
  const c = attendanceCounts(out.map((r) => r.status));
  return {
    day,
    from: from.toISOString(),
    to: to.toISOString(),
    isToday: businessDate(new Date(now), hotel.timezone, hotel.dayStartsAt) === day,
    timezone: hotel.timezone,
    counts: { ...c, total: out.length },
    rows: out,
  };
}
