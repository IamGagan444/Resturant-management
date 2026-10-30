import type {
  HubQueuedCommand,
  HubSnapshot,
  KdsTicket,
  OrderItemView,
  QueuedCommand,
  ServerEventName,
  ServerEventPayload,
  StaffRole,
  WaiterBoard,
} from "@rms/contracts";
import { checkItemTransition, deriveOrderStatus, priceLine, stampsFor, type Actor, type PricingAddonGroup } from "@rms/domain";

/**
 * The hub's whole world: the last cloud snapshot with local changes applied on top,
 * plus the outbox of commands still to replay to the cloud. Pure functions only,
 * so the rules are unit-tested without a network or a server.
 */
export interface HubState {
  snapshot: HubSnapshot | null;
  outbox: HubQueuedCommand[];
  /** client ids already accepted (queued or replayed), so a device re-sending its queue is harmless */
  seen: string[];
  /** device time of the latest local availability toggle per menu item (last writer wins) */
  availabilityAt: Record<string, string>;
  localOrderSeq: number;
  lastSyncAt: string | null;
  /** bumped on every local change; a snapshot fetched before a change must not overwrite it */
  version: number;
}

export const emptyState = (): HubState => ({ snapshot: null, outbox: [], seen: [], availabilityAt: {}, localOrderSeq: 0, lastSyncAt: null, version: 0 });

export interface HubActor {
  staffId: string;
  role: StaffRole;
  sid: string | null;
}

export type HubEvent = { [E in ServerEventName]: { event: E; payload: Omit<ServerEventPayload<E>, "at"> } }[ServerEventName];

export interface ApplyResult {
  outcome: "APPLIED" | "NOOP" | "REJECTED";
  reason?: string;
  events: HubEvent[];
}

const SEEN_MAX = 5000;
/** Local orders get numbers from 9001 so the kitchen can tell them apart until the cloud numbers them. */
export const LOCAL_ORDER_BASE = 9000;

function remember(state: HubState, clientId: string) {
  state.seen.push(clientId);
  if (state.seen.length > SEEN_MAX) state.seen.splice(0, state.seen.length - SEEN_MAX);
}

function findItem(snap: HubSnapshot, orderItemId: string): { order: KdsTicket; item: KdsTicket["items"][number] } | null {
  for (const order of snap.orders) {
    const item = order.items.find((i) => i.id === orderItemId);
    if (item) return { order, item };
  }
  return null;
}

const toIso = (d: Partial<Record<string, Date>>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v?.toISOString() ?? null]));

/**
 * Apply one staff command to the hub's view and queue it for the cloud.
 * Rules match the cloud: status only moves forward, roles are checked, creates are idempotent.
 * Anything the hub can't check (an item it has never seen) is queued and left to the cloud to decide.
 */
export function applyCommand(state: HubState, actor: HubActor, q: QueuedCommand, now = new Date()): ApplyResult {
  const snap = state.snapshot;
  if (!snap) return { outcome: "REJECTED", reason: "Hub has no data yet", events: [] };
  if (state.seen.includes(q.clientId)) return { outcome: "NOOP", events: [] };
  const hotelId = snap.hotel.id;
  const c = q.command;
  const events: HubEvent[] = [];
  const reject = (reason: string): ApplyResult => ({ outcome: "REJECTED", reason, events: [] });
  const noop = (): ApplyResult => ({ outcome: "NOOP", events: [] });

  switch (c.type) {
    case "item.transition": {
      const found = findItem(snap, c.orderItemId);
      if (found) {
        const { order, item } = found;
        const check = checkItemTransition(item.status, c.to, actor.role as Actor);
        if (!check.ok) {
          if (check.reason === "NOOP") return noop();
          return reject(check.reason === "FORBIDDEN" ? `Your role can't move an item from ${item.status} to ${c.to}` : `Can't move an item from ${item.status} to ${c.to}`);
        }
        if (c.to === "CANCELLED" && item.status !== "OUT_OF_STOCK" && !c.reason) return reject("Give a reason for cancelling");
        const existing = {
          startedAt: item.startedAt ? new Date(item.startedAt) : null,
          readyAt: item.readyAt ? new Date(item.readyAt) : null,
          pickedUpAt: item.pickedUpAt ? new Date(item.pickedUpAt) : null,
          servedAt: item.servedAt ? new Date(item.servedAt) : null,
        };
        const from = item.status;
        Object.assign(item, toIso(stampsFor(from, c.to, now, existing)), { status: c.to, updatedAt: now.toISOString() });
        order.status = deriveOrderStatus(order.status, order.items);
        events.push({
          event: "item:status_changed",
          payload: { hotelId, orderItemId: item.id, orderId: order.id, sessionId: order.sessionId, stationId: item.stationId, from, to: c.to, updatedAt: now.toISOString() },
        });
        if (c.to === "OUT_OF_STOCK") {
          events.push({ event: "item:out_of_stock", payload: { hotelId, orderItemId: item.id, orderId: order.id, sessionId: order.sessionId, menuItemId: item.itemId } });
        }
      } else if (snap.pendingOrders.some((o) => o.items.some((i) => i.id === c.orderItemId))) {
        return reject("Order is waiting for confirmation");
      }
      break; // unknown here (e.g. made on another device moments before the outage): queue it, the cloud decides
    }

    case "order.bump": {
      const order = snap.orders.find((o) => o.id === c.orderId);
      if (!order) break;
      const todo = order.items.filter((i) => i.status === "QUEUED" || i.status === "COOKING");
      if (!todo.length) return noop();
      for (const item of todo) {
        const from = item.status;
        Object.assign(item, toIso(stampsFor(from, "READY", now, {})), { status: "READY", updatedAt: now.toISOString() });
        events.push({
          event: "item:status_changed",
          payload: { hotelId, orderItemId: item.id, orderId: order.id, sessionId: order.sessionId, stationId: item.stationId, from, to: "READY", updatedAt: now.toISOString() },
        });
      }
      order.status = deriveOrderStatus(order.status, order.items);
      break;
    }

    case "menu.availability": {
      const prev = state.availabilityAt[c.menuItemId];
      if (prev && prev > q.clientTs) return noop();
      const row = snap.menuItems.find((m) => m.id === c.menuItemId);
      const item = snap.menu.items.find((m) => m.id === c.menuItemId);
      if (row?.isAvailable === c.isAvailable && (!item || item.isAvailable === c.isAvailable)) return noop();
      if (row) row.isAvailable = c.isAvailable;
      if (item) item.isAvailable = c.isAvailable;
      state.availabilityAt[c.menuItemId] = q.clientTs;
      events.push({ event: "menu:item_availability", payload: { hotelId, menuItemId: c.menuItemId, isAvailable: c.isAvailable } });
      break;
    }

    case "request.ack":
    case "request.done": {
      const r = snap.requests.find((x) => x.id === c.requestId);
      if (r) {
        if (c.type === "request.ack") {
          if (r.status !== "OPEN") return noop();
          r.status = "ACKNOWLEDGED";
          events.push({ event: "request:acknowledged", payload: { hotelId, requestId: r.id, sessionId: r.sessionId, byStaffId: actor.staffId } });
        } else {
          snap.requests = snap.requests.filter((x) => x.id !== r.id);
          events.push({ event: "request:done", payload: { hotelId, requestId: r.id, sessionId: r.sessionId } });
        }
      }
      break;
    }

    case "session.confirm": {
      const table = snap.tables.find((t) => t.session?.id === c.sessionId);
      if (table?.session) table.session.isConfirmed = true;
      const held = snap.pendingOrders.filter((o) => o.sessionId === c.sessionId);
      snap.pendingOrders = snap.pendingOrders.filter((o) => o.sessionId !== c.sessionId);
      for (const o of held) {
        const ticket: KdsTicket = { ...o, status: "PLACED", items: o.items.map((i) => ({ ...i, prepTimeMin: prepTime(snap, i) })) };
        snap.orders.push(ticket);
        events.push(placedEvent(hotelId, ticket));
      }
      events.push({ event: "session:confirmed", payload: { hotelId, sessionId: c.sessionId, byStaffId: actor.staffId } });
      break;
    }

    case "order.create": {
      const table = snap.tables.find((t) => t.id === c.tableId);
      if (!table) return reject("Unknown table");
      const groups = new Map<string, PricingAddonGroup>(snap.menu.addonGroups.map((g) => [g.id, g]));
      const items: KdsTicket["items"] = [];
      for (const l of c.lines) {
        const m = snap.menu.items.find((i) => i.id === l.itemId);
        if (!m) return reject("Unknown dish");
        const r = priceLine(m, groups, { variantId: l.variantId ?? null, addonIds: l.addonIds, quantity: l.quantity });
        if (!r.ok) return reject(`${m.name} can't be ordered right now`);
        items.push({
          id: l.id,
          orderId: q.clientId,
          itemId: m.id,
          guestId: null,
          stationId: snap.menuItems.find((x) => x.id === m.id)?.stationId ?? null,
          name: m.name,
          variantName: r.line.variantName,
          addons: r.line.addons.map((a) => ({ name: a.name, price: a.price })),
          unitPrice: r.line.unitPrice,
          quantity: l.quantity,
          note: l.note ?? null,
          status: "QUEUED",
          startedAt: null,
          readyAt: null,
          pickedUpAt: null,
          servedAt: null,
          updatedAt: now.toISOString(),
          prepTimeMin: m.prepTimeMin,
        });
      }
      if (!table.session) {
        table.session = { id: `local-${table.id}`, joinCode: "----", isConfirmed: true, guestCount: 0, openedAt: now.toISOString() };
        table.status = "OCCUPIED";
        events.push({ event: "table:status_changed", payload: { hotelId, tableId: table.id, status: "OCCUPIED" } });
      }
      const ticket: KdsTicket = {
        id: q.clientId,
        sessionId: table.session.id,
        tableLabel: table.label,
        orderNumber: LOCAL_ORDER_BASE + ++state.localOrderSeq,
        source: "WAITER",
        status: "PLACED",
        note: c.note ?? null,
        etaAt: null,
        placedAt: now.toISOString(),
        items,
      };
      snap.orders.push(ticket);
      events.push(placedEvent(hotelId, ticket));
      break;
    }
  }

  state.outbox.push({ ...q, staffId: actor.staffId });
  remember(state, q.clientId);
  state.version++;
  return { outcome: "APPLIED", events };
}

function prepTime(snap: HubSnapshot, item: OrderItemView) {
  return snap.menu.items.find((m) => m.id === item.itemId)?.prepTimeMin ?? 15;
}

function placedEvent(hotelId: string, t: KdsTicket): HubEvent {
  return {
    event: "order:placed",
    payload: {
      hotelId,
      orderId: t.id,
      sessionId: t.sessionId,
      tableLabel: t.tableLabel,
      orderNumber: t.orderNumber,
      stationIds: [...new Set(t.items.flatMap((i) => (i.stationId ? [i.stationId] : [])))],
    },
  };
}

// ── Views (same shapes as the cloud's /v1/s/kds and /v1/s/waiter/board) ──

const LIVE = new Set(["PLACED", "IN_PROGRESS", "READY"]);

export function kdsView(snap: HubSnapshot, stationId: string | null): KdsTicket[] {
  return snap.orders
    .filter((o) => LIVE.has(o.status))
    .map((o) => ({
      ...o,
      items: o.items.filter(
        (i) => (i.status === "QUEUED" || i.status === "COOKING" || i.status === "READY") && (!stationId || i.stationId === stationId || i.stationId === null),
      ),
    }))
    .filter((o) => o.items.length > 0)
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt));
}

export function boardView(snap: HubSnapshot, waiterId: string | null): WaiterBoard {
  const mine = waiterId ? Object.entries(snap.assignments).flatMap(([tableId, staff]) => (staff.includes(waiterId) ? [tableId] : [])) : [];
  const tables = mine.length ? snap.tables.filter((t) => mine.includes(t.id)) : snap.tables;
  const sessions = new Set(tables.flatMap((t) => (t.session ? [t.session.id] : [])));
  const ready = snap.orders
    .filter((o) => sessions.has(o.sessionId))
    .flatMap((o) =>
      o.items
        .filter((i) => i.status === "READY" || i.status === "PICKED_UP" || i.status === "OUT_OF_STOCK")
        .map(({ prepTimeMin: _p, ...i }) => ({ ...i, sessionId: o.sessionId, orderNumber: o.orderNumber })),
    )
    .sort((a, b) => (a.readyAt ?? "").localeCompare(b.readyAt ?? ""));
  return {
    tables,
    ready,
    pendingOrders: snap.pendingOrders.filter((o) => sessions.has(o.sessionId)),
    requests: snap.requests.filter((r) => sessions.has(r.sessionId)),
  };
}
