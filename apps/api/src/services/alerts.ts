import { db, unscopedDb, withTenant, type Hotel, type StaffRole } from "@rms/db";
import type { PushPayload } from "@rms/contracts";
import { getHotel } from "../lib/hotel";
import { pushTransport } from "../lib/push";
import { redis } from "../jobs/queue";
import { assignmentsToday, waiterBoard } from "./floorData";
import { sessionLabel } from "./views";

/**
 * Rings staff phones that aren't showing the app (locked, in a pocket, on a call, in another app).
 *
 * It works from what is still waiting, not from single events, so nothing is missed after a restart and ringing
 * stops by itself once someone acts:
 *   cook     new order nobody at their station has started
 *   waiter   dish ready, guest request, order to confirm — their tables (all waiters if nobody is assigned)
 *   cashier  bill requested
 * Nobody acted within ESCALATE_MS (or nobody reachable): every waiter, managers and owners ring too.
 */
const ESCALATE_MS = 2 * 60_000;
/** Older than this is a forgotten tap, not news. */
const STALE_MS = 30 * 60_000;
const FAST_MS = 5 * 60_000;
const REPEAT_FAST_SEC = 25;
const REPEAT_SLOW_SEC = 120;

type Kind = "ORDER" | "READY" | "REQUEST" | "CONFIRM" | "BILL";
interface Alert {
  key: string;
  kind: Kind;
  at: Date;
  text: string;
  tableId?: string;
  stationId?: string | null;
}

const REQUEST_TEXT = { CALL_WAITER: "Waiter called", WATER: "Water", CUTLERY: "Cutlery", BILL: "Bill", OTHER: "Request" } as const;

async function outstanding(hotel: Hotel): Promise<Alert[]> {
  const since = new Date(Date.now() - STALE_MS);
  const [orders, board] = await Promise.all([
    db.order.findMany({
      where: { status: { in: ["PLACED", "IN_PROGRESS"] }, updatedAt: { gt: since }, items: { some: { status: "QUEUED" } } },
      select: {
        id: true,
        placedAt: true,
        orderNumber: true,
        items: { select: { status: true, stationId: true } },
        session: { select: { parcelNo: true, table: { select: { label: true } } } },
      },
    }),
    waiterBoard(hotel, null), // exactly what the waiter screen rings for
  ]);
  const alerts: Alert[] = [];
  for (const o of orders) {
    for (const stationId of new Set(o.items.map((i) => i.stationId))) {
      const items = o.items.filter((i) => i.stationId === stationId && i.status !== "CANCELLED" && i.status !== "OUT_OF_STOCK");
      if (!items.length || items.some((i) => i.status !== "QUEUED")) continue;
      // when it reached the kitchen: held orders are released later than they were placed
      const at = new Date(Math.max(o.placedAt.getTime(), await firstSeen(`o:${o.id}:${stationId}`)));
      alerts.push({ key: `o:${o.id}:${stationId}`, kind: "ORDER", at, stationId, text: `${sessionLabel(o.session)} · order #${o.orderNumber}` });
    }
  }
  for (const i of board.ready) {
    if (i.status === "READY" && i.readyAt) alerts.push({ key: `i:${i.id}`, kind: "READY", at: new Date(i.readyAt), tableId: i.tableId, text: `${i.tableLabel} · ${i.quantity} × ${i.name} ready` });
  }
  for (const r of board.requests) {
    if (r.status !== "OPEN") continue;
    const at = new Date(r.createdAt);
    alerts.push({ key: `r:${r.id}`, kind: "REQUEST", at, tableId: r.tableId, text: `${r.tableLabel} · ${REQUEST_TEXT[r.type]}` });
    if (r.type === "BILL") alerts.push({ key: `b:${r.id}`, kind: "BILL", at, tableId: r.tableId, text: `${r.tableLabel} · bill requested` });
  }
  for (const o of board.pendingOrders) {
    alerts.push({ key: `c:${o.id}`, kind: "CONFIRM", at: new Date(o.placedAt), tableId: o.tableId, text: `${o.tableLabel} · confirm order #${o.orderNumber}` });
  }
  return alerts.filter((a) => a.at > since);
}

/** When this order first counted as waiting (ms), remembered for as long as it can matter. */
async function firstSeen(key: string): Promise<number> {
  const k = `alerts:seen:${key}`;
  await redis.set(k, String(Date.now()), "PX", STALE_MS * 2, "NX");
  return Number((await redis.get(k)) ?? Date.now());
}

interface Reachable {
  staffId: string;
  role: StaffRole;
  subs: { id: string; endpoint: string; p256dh: string; auth: string; stationId: string | null }[];
}

/** Staff with a browser to ring: on duty, still signed in there, device not removed. */
async function reachable(hotelId: string): Promise<Reachable[]> {
  const subs = await db.pushSubscription.findMany({
    where: { pausedAt: null, staff: { isActive: true } },
    select: { id: true, endpoint: true, p256dh: true, auth: true, familyId: true, deviceId: true, staffId: true, staff: { select: { role: true, stationId: true } } },
  });
  if (!subs.length) return [];
  const [alive, devices] = await Promise.all([
    unscopedDb.refreshToken.findMany({
      where: { familyId: { in: [...new Set(subs.map((s) => s.familyId))] }, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { familyId: true, subjectId: true },
    }),
    db.device.findMany({ where: { hotelId }, select: { id: true, stationId: true, revokedAt: true } }),
  ]);
  const live = new Set(alive.map((a) => `${a.familyId}:${a.subjectId}`));
  const deviceOf = new Map(devices.map((d) => [d.id, d]));
  const people = new Map<string, Reachable>();
  for (const s of subs) {
    const device = s.deviceId ? deviceOf.get(s.deviceId) : null;
    if (!live.has(`${s.familyId}:${s.staffId}`) || (s.deviceId && (!device || device.revokedAt))) continue;
    const p = people.get(s.staffId) ?? { staffId: s.staffId, role: s.staff.role, subs: [] };
    p.subs.push({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, stationId: device?.stationId ?? s.staff.stationId });
    people.set(s.staffId, p);
  }
  return [...people.values()];
}

/** Staff ids with at least one browser that will ring (shown to managers). */
export const reachableStaffIds = async (hotelId: string) => new Set((await reachable(hotelId)).map((p) => p.staffId));

const isLead = (r: StaffRole) => r === "MANAGER" || r === "OWNER";

function targetsOf(a: Alert, people: Reachable[], assigned: Record<string, string[]>): Reachable[] {
  const late = Date.now() - a.at.getTime() >= ESCALATE_MS;
  const leads = people.filter((p) => isLead(p.role));
  let first: Reachable[];
  let wider: Reachable[];
  if (a.kind === "ORDER") {
    const cooks = people.filter((p) => p.role === "COOK");
    first = cooks.filter((p) => p.subs.some((s) => s.stationId === null || a.stationId === null || s.stationId === a.stationId));
    wider = [...cooks, ...leads]; // the right station isn't answering: anyone in the kitchen, and the managers
  } else if (a.kind === "BILL") {
    first = people.filter((p) => p.role === "CASHIER");
    wider = [...first, ...leads];
  } else {
    const waiters = people.filter((p) => p.role === "WAITER");
    const own = a.tableId ? (assigned[a.tableId] ?? []) : [];
    first = own.length ? waiters.filter((p) => own.includes(p.staffId)) : waiters;
    wider = [...waiters, ...leads];
  }
  return late || first.length === 0 ? wider : first;
}

const TITLE: Record<Kind, string> = { ORDER: "New order", READY: "Pick up", REQUEST: "Guest is calling", CONFIRM: "Confirm order", BILL: "Bill requested" };
const HOME: Record<StaffRole, string> = { COOK: "/kds/", WAITER: "/waiter/", CASHIER: "/cashier/", MANAGER: "/floor/", OWNER: "/floor/" };

function payloadFor(p: Reachable, mine: Alert[]): PushPayload {
  const latest = [...mine].sort((x, y) => y.at.getTime() - x.at.getTime());
  const first = latest[0];
  return {
    title: mine.length === 1 && first ? TITLE[first.kind] : `${mine.length} waiting`,
    body: latest.slice(0, 4).map((a) => a.text).join("\n") + (latest.length > 4 ? `\n+${latest.length - 4} more` : ""),
    url: HOME[p.role],
  };
}

/** Anything new rings at once; what stays waiting rings again every REPEAT seconds. Stamps in Redis: several API servers never double-ring. */
async function shouldRing(p: Reachable, mine: Alert[]): Promise<boolean> {
  let fresh = false;
  for (const a of mine) {
    if ((await redis.set(`alerts:rung:${p.staffId}:${a.key}`, "1", "PX", STALE_MS * 2, "NX")) === "OK") fresh = true;
  }
  const youngest = Math.max(...mine.map((a) => a.at.getTime()));
  const every = Date.now() - youngest < FAST_MS ? REPEAT_FAST_SEC : REPEAT_SLOW_SEC;
  const paceKey = `alerts:pace:${p.staffId}`;
  if (fresh) {
    await redis.set(paceKey, "1", "EX", every);
    return true;
  }
  return (await redis.set(paceKey, "1", "EX", every, "NX")) === "OK";
}

export async function sweepHotel(hotelId: string): Promise<void> {
  await withTenant(hotelId, async () => {
    const people = await reachable(hotelId);
    if (!people.length) return;
    const hotel = await getHotel(hotelId);
    const [alerts, assigned] = await Promise.all([outstanding(hotel), assignmentsToday(hotel)]);
    const mineOf = new Map<Reachable, Alert[]>();
    for (const a of alerts) for (const p of targetsOf(a, people, assigned)) mineOf.set(p, [...(mineOf.get(p) ?? []), a]);
    await Promise.all(
      [...mineOf].map(async ([p, mine]) => {
        if (!(await shouldRing(p, mine))) return;
        await Promise.all(p.subs.map((s) => deliver(s, payloadFor(p, mine))));
      }),
    );
  });
}

async function deliver(sub: Reachable["subs"][number], payload: PushPayload) {
  const r = await pushTransport.send(sub, payload);
  if (r === "GONE") await db.pushSubscription.deleteMany({ where: { id: sub.id } }); // app removed or permission withdrawn
}

/** "Test" button, a few seconds later so there's time to lock the phone. */
export async function sendTest(hotelId: string, subscriptionId: string): Promise<void> {
  await withTenant(hotelId, async () => {
    const s = await db.pushSubscription.findUnique({ where: { id: subscriptionId } });
    if (s) await deliver({ ...s, stationId: null }, { title: "Test alert", body: "Alerts reach this phone.", url: "/" });
  });
}

/** Safety net behind the event-driven sweeps, and what makes alerts repeat. */
export async function sweepAll(): Promise<void> {
  const hotels = await unscopedDb.pushSubscription.findMany({ where: { pausedAt: null, hotel: { status: { in: ["TRIAL", "ACTIVE"] } } }, select: { hotelId: true }, distinct: ["hotelId"] });
  for (const { hotelId } of hotels) {
    await sweepHotel(hotelId).catch((e: unknown) => console.error(`alerts ${hotelId}:`, e instanceof Error ? e.message : e)); // one restaurant's trouble must not silence the others
  }
}
