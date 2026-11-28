import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { unscopedDb, withTenant, db } from "@rms/db";
import type { AttendanceDay } from "@rms/contracts";
import { PRESENCE, businessDate, businessDayRange } from "@rms/domain";
import { closeQueue } from "../src/jobs/queue";
import { endPresence, resetPresenceThrottle, touchPresence } from "../src/services/presence";
import { Client, createHotel, createPlatformAdmin, getApp, resetDb, staffOnDevice } from "./helpers";

const IST = "Asia/Kolkata";
const MIN = 60_000;
const H = 60 * MIN;

/** Waits for the fire-and-forget presence write a request triggered. */
async function eventually(check: () => Promise<boolean>, ms = 3000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("condition not met in time");
}

describe("staff attendance", () => {
  let app: FastifyInstance;
  let admin: Client;
  let owner: Client;
  let hotelId: string;
  let waiterId: string;
  let cookId: string;
  let cashierId: string;
  const spans = (staffId: string) => withTenant(hotelId, async () => await db.staffPresence.findMany({ where: { staffId }, orderBy: { startedAt: "asc" } }));
  const today = () => businessDate(new Date(), IST, "04:00");
  const row = (d: AttendanceDay, id: string) => d.rows.find((r) => r.staff.id === id)!;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    admin = await createPlatformAdmin(app);
    ({ owner, hotelId } = await createHotel(app, admin, "att"));
    waiterId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Ravi", role: "WAITER", pin: "4001" })).id;
    cookId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Raju", role: "COOK", pin: "3001" })).id;
    cashierId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Kavya", role: "CASHIER", pin: "2000" })).id;
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  it("a PIN sign-in shows the person on duty; nobody else is in yet", async () => {
    const waiter = await staffOnDevice(owner, "WAITER", waiterId, "4001");
    await eventually(async () => (await spans(waiterId)).length === 1);
    const d = await owner.ok<AttendanceDay>("GET", "/v1/admin/attendance");
    expect(d.day).toBe(today());
    expect(d.isToday).toBe(true);
    expect(row(d, waiterId).status).toBe("ON_DUTY");
    expect(row(d, cookId).status).toBe("NOT_IN"); // the day isn't over: not "absent" yet
    expect(d.rows.some((r) => r.staff.role === "OWNER")).toBe(false);
    expect(d.counts).toMatchObject({ present: 1, onDuty: 1, notIn: 2, total: 3 });

    // signing out ends "on duty" at once, but they still came in today
    await waiter.ok("POST", "/v1/auth/logout");
    await eventually(async () => (await spans(waiterId)).every((s) => s.endedAt !== null));
    const after = await owner.ok<AttendanceDay>("GET", "/v1/admin/attendance");
    expect(row(after, waiterId).status).toBe("PRESENT");
  });

  it("every staff request keeps the span alive (one row, lastSeenAt moves) and is throttled to a write a minute", async () => {
    const cook = await staffOnDevice(owner, "KDS", cookId, "3001");
    await eventually(async () => (await spans(cookId)).length === 1);
    const first = (await spans(cookId))[0]!;
    for (let i = 0; i < 5; i++) await cook.ok("GET", "/v1/s/kds");
    await new Promise((r) => setTimeout(r, 200));
    const rows = await spans(cookId);
    expect(rows).toHaveLength(1);
    // inside the one-minute throttle: the polls didn't rewrite the row
    expect(rows[0]!.lastSeenAt.getTime()).toBe(first.lastSeenAt.getTime());
  });

  it("20 devices pinging at the same instant open exactly one span (per-person lock)", async () => {
    resetPresenceThrottle();
    const now = Date.now() + 2 * PRESENCE.GAP_MS; // far enough ahead that it can't extend anything
    await Promise.all(Array.from({ length: 20 }, () => touchPresence(hotelId, cashierId, null, { force: true, now })));
    const rows = (await spans(cashierId)).filter((s) => s.startedAt.getTime() === now);
    expect(rows).toHaveLength(1);
    await withTenant(hotelId, async () => await db.staffPresence.deleteMany({ where: { staffId: cashierId } }));
  });

  it("rebuilds a past day exactly: gaps split spans, hours are exact, the rest are absent", async () => {
    const day = "2026-11-20";
    const { from } = businessDayRange(day, IST, "04:00");
    const at = (h: number) => from.getTime() + h * H; // hours after 04:00 IST
    const ping = (t: number) => touchPresence(hotelId, cashierId, null, { force: true, now: t });
    // 10:00–14:00 IST polling every 30 s, a 2 h break, 16:00–20:00, then signs out
    for (let t = at(6); t <= at(10); t += 30_000) await ping(t);
    for (let t = at(12); t <= at(16); t += 30_000) await ping(t);
    await endPresence(hotelId, cashierId, { now: at(16) });

    const d = await owner.ok<AttendanceDay>("GET", `/v1/admin/attendance?day=${day}`);
    const r = row(d, cashierId);
    expect(d.isToday).toBe(false);
    expect(r.status).toBe("PRESENT");
    expect(r.spans).toHaveLength(2);
    expect(r.workedMin).toBe(8 * 60);
    expect(r.firstIn).toBe(new Date(at(6)).toISOString());
    expect(r.lastSeen).toBe(new Date(at(16)).toISOString());
    expect(row(d, cookId).status).toBe("ABSENT");
    await withTenant(hotelId, async () => await db.staffPresence.deleteMany({ where: { staffId: cashierId } }));
  });

  it("a night shift is split across the two business days it touches", async () => {
    const day = "2026-11-21";
    const { to } = businessDayRange(day, IST, "04:00"); // 04:00 IST on the 22nd
    for (let t = to.getTime() - 3 * H; t <= to.getTime() + 2 * H; t += 30_000) await touchPresence(hotelId, cashierId, null, { force: true, now: t });
    const d1 = await owner.ok<AttendanceDay>("GET", `/v1/admin/attendance?day=${day}`);
    const d2 = await owner.ok<AttendanceDay>("GET", "/v1/admin/attendance?day=2026-11-22");
    expect(row(d1, cashierId).workedMin).toBe(180);
    expect(row(d2, cashierId).workedMin).toBe(120);
    await withTenant(hotelId, async () => await db.staffPresence.deleteMany({ where: { staffId: cashierId } }));
  });

  it("managers mark leave / week off / present; a mark that contradicts the devices is flagged; marks are audited", async () => {
    const day = today();
    await owner.ok("PUT", `/v1/admin/attendance/${cookId}/${day}`, { kind: "WEEK_OFF", note: "Swapped with Suresh" });
    let d = await owner.ok<AttendanceDay>("GET", "/v1/admin/attendance");
    expect(row(d, cookId)).toMatchObject({ status: "WEEK_OFF", conflict: true, mark: { kind: "WEEK_OFF", note: "Swapped with Suresh", by: "Owner" } });

    await owner.ok("PUT", `/v1/admin/attendance/${cashierId}/${day}`, { kind: "PRESENT" });
    d = await owner.ok<AttendanceDay>("GET", "/v1/admin/attendance");
    expect(row(d, cashierId)).toMatchObject({ status: "PRESENT", conflict: false });

    // clearing goes back to what the devices saw
    await owner.ok("PUT", `/v1/admin/attendance/${cookId}/${day}`, { kind: null });
    d = await owner.ok<AttendanceDay>("GET", "/v1/admin/attendance");
    expect(row(d, cookId).mark).toBeNull();

    const log = await withTenant(hotelId, async () => await db.auditLog.findMany({ where: { action: "ATTENDANCE_MARKED" } }));
    expect(log).toHaveLength(3);
  });

  it("rejects bad input and other people's data", async () => {
    expect((await owner.req("GET", "/v1/admin/attendance?day=2026-02-31")).statusCode).toBe(400);
    expect((await owner.req("GET", "/v1/admin/attendance?day=yesterday")).statusCode).toBe(400);
    expect((await owner.req("PUT", `/v1/admin/attendance/${cookId}/2030-01-01`, { kind: "LEAVE" })).statusCode).toBe(400); // too far ahead
    expect((await owner.req("PUT", `/v1/admin/attendance/${cookId}/${today()}`, { kind: "HOLIDAY" })).statusCode).toBe(400);

    // a waiter can't see the register
    const waiter = await staffOnDevice(owner, "WAITER", waiterId, "4001");
    expect((await waiter.req("GET", "/v1/admin/attendance")).statusCode).toBe(403);

    // another restaurant can neither see nor mark this one's staff
    const { owner: other } = await createHotel(app, admin, "att-other");
    const theirs = await other.ok<AttendanceDay>("GET", "/v1/admin/attendance");
    expect(theirs.rows.map((r) => r.staff.id)).not.toContain(cookId);
    const r = await other.req("PUT", `/v1/admin/attendance/${cookId}/${today()}`, { kind: "ABSENT" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("INVALID_REFERENCE");
    expect(await unscopedDb.attendanceMark.count({ where: { staffId: cookId, kind: "ABSENT" } })).toBe(0);
  });
});
