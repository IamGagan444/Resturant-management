import type { ItemStatus, OrderStatus } from "@rms/contracts";

/**
 * Item status machine.
 *
 *   QUEUED → COOKING → READY → PICKED_UP → SERVED      (main line, forward only)
 *   QUEUED|COOKING → OUT_OF_STOCK → CANCELLED          (customer removes / replaces)
 *   any non-terminal → CANCELLED                        (manager only once cooking started)
 *
 * Forward-only is what makes offline sync conflict-free: replaying a stale command
 * whose target is at or behind the current status is a NOOP, never a regression.
 */

export type Actor = "COOK" | "WAITER" | "CASHIER" | "MANAGER" | "OWNER" | "CUSTOMER" | "SYSTEM";

const MAIN_LINE: readonly ItemStatus[] = ["QUEUED", "COOKING", "READY", "PICKED_UP", "SERVED"];

const EDGES: Readonly<Record<ItemStatus, readonly ItemStatus[]>> = {
  QUEUED: ["COOKING", "READY", "PICKED_UP", "SERVED", "OUT_OF_STOCK", "CANCELLED"],
  COOKING: ["READY", "PICKED_UP", "SERVED", "OUT_OF_STOCK", "CANCELLED"],
  READY: ["PICKED_UP", "SERVED", "CANCELLED"],
  PICKED_UP: ["SERVED"],
  OUT_OF_STOCK: ["CANCELLED"],
  SERVED: [],
  CANCELLED: [],
};

type Edge = `${ItemStatus}>${ItemStatus}`;

const ROLE_EDGES: Readonly<Record<Actor, ReadonlySet<Edge> | "ALL">> = {
  COOK: new Set<Edge>([
    "QUEUED>COOKING",
    "QUEUED>READY",
    "COOKING>READY",
    "QUEUED>OUT_OF_STOCK",
    "COOKING>OUT_OF_STOCK",
  ]),
  WAITER: new Set<Edge>(["READY>PICKED_UP", "READY>SERVED", "PICKED_UP>SERVED", "QUEUED>CANCELLED"]),
  CASHIER: new Set<Edge>(),
  CUSTOMER: new Set<Edge>(["OUT_OF_STOCK>CANCELLED"]),
  MANAGER: "ALL",
  OWNER: "ALL",
  SYSTEM: "ALL",
};

export type TransitionCheck = { ok: true } | { ok: false; reason: "NOOP" | "INVALID" | "FORBIDDEN" };

export function isTerminal(s: ItemStatus): boolean {
  return EDGES[s].length === 0;
}

export function checkItemTransition(from: ItemStatus, to: ItemStatus, actor: Actor): TransitionCheck {
  if (from === to) return { ok: false, reason: "NOOP" };
  const fi = MAIN_LINE.indexOf(from);
  const ti = MAIN_LINE.indexOf(to);
  // Stale replay: target already reached or passed on the main line.
  if (fi !== -1 && ti !== -1 && ti < fi) return { ok: false, reason: "NOOP" };
  // Item already left the main line (cancelled / out of stock) and a stale main-line command arrives.
  if (fi === -1 && ti !== -1) return { ok: false, reason: "NOOP" };
  if (!EDGES[from].includes(to)) return { ok: false, reason: "INVALID" };
  const allowed = ROLE_EDGES[actor];
  if (allowed !== "ALL" && !allowed.has(`${from}>${to}`)) return { ok: false, reason: "FORBIDDEN" };
  return { ok: true };
}

type StampField = "startedAt" | "readyAt" | "pickedUpAt" | "servedAt";
const STAMP: Partial<Record<ItemStatus, StampField>> = {
  COOKING: "startedAt",
  READY: "readyAt",
  PICKED_UP: "pickedUpAt",
  SERVED: "servedAt",
};

/**
 * Timestamps to set for a transition. Skipped main-line steps get stamped too
 * (READY → SERVED also sets pickedUpAt) so serve-time reports never see gaps.
 * `existing` fields that are already set are left alone.
 */
export function stampsFor(
  from: ItemStatus,
  to: ItemStatus,
  now: Date,
  existing: Partial<Record<StampField, Date | null>> = {},
): Partial<Record<StampField, Date>> {
  const out: Partial<Record<StampField, Date>> = {};
  const fi = MAIN_LINE.indexOf(from);
  const ti = MAIN_LINE.indexOf(to);
  if (fi === -1 || ti === -1) return out;
  // QUEUED → READY skips COOKING: leave startedAt null (cook never pressed Start).
  for (let i = Math.max(fi + 1, 2); i <= ti; i++) {
    const field = STAMP[MAIN_LINE[i] as ItemStatus];
    if (field && !existing[field]) out[field] = now;
  }
  if (to === "COOKING" && !existing.startedAt) out.startedAt = now;
  return out;
}

/** Statuses that the order holds regardless of item progress. */
const HELD: ReadonlySet<OrderStatus> = new Set(["AWAITING_PAYMENT", "PENDING_CONFIRMATION", "CANCELLED"]);

/** Order status is derived from its items once the order is released to the kitchen. */
export function deriveOrderStatus(current: OrderStatus, items: readonly { status: ItemStatus }[]): OrderStatus {
  if (HELD.has(current)) return current;
  const live = items.filter((i) => i.status !== "CANCELLED");
  if (live.length === 0) return "CANCELLED";
  if (live.every((i) => i.status === "SERVED")) return "SERVED";
  if (live.every((i) => i.status === "READY" || i.status === "PICKED_UP" || i.status === "SERVED")) return "READY";
  if (live.some((i) => i.status !== "QUEUED" && i.status !== "OUT_OF_STOCK")) return "IN_PROGRESS";
  return "PLACED";
}

/** Customer-facing tracker step: Received → Cooking → Ready → On the way → Served. */
export type TrackerStep = "RECEIVED" | "COOKING" | "READY" | "ON_THE_WAY" | "SERVED" | "CANCELLED" | "OUT_OF_STOCK";

export function trackerStep(s: ItemStatus): TrackerStep {
  switch (s) {
    case "QUEUED":
      return "RECEIVED";
    case "PICKED_UP":
      return "ON_THE_WAY";
    default:
      return s;
  }
}
