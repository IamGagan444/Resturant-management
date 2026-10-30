import { describe, expect, it } from "vitest";
import type { HubSnapshot, KdsTicket, QueuedCommand } from "@rms/contracts";
import { LOCAL_ORDER_BASE, applyCommand, boardView, emptyState, kdsView, type HubActor, type HubState } from "../src/state";

const cook: HubActor = { staffId: "cook-1", role: "COOK", sid: "tandoor" };
const waiter: HubActor = { staffId: "waiter-1", role: "WAITER", sid: null };
let n = 0;
const q = (command: QueuedCommand["command"], clientTs = new Date().toISOString()): QueuedCommand => ({ clientId: `client-${++n}-xxxx`, clientTs, command });

function item(id: string, status: KdsTicket["items"][number]["status"], stationId: string | null = "tandoor"): KdsTicket["items"][number] {
  return {
    id,
    orderId: "o1",
    itemId: "naan",
    guestId: null,
    stationId,
    name: "Naan",
    variantName: null,
    addons: [],
    unitPrice: 6000,
    quantity: 1,
    note: null,
    status,
    startedAt: null,
    readyAt: status === "READY" ? "2026-10-30T10:00:00.000Z" : null,
    pickedUpAt: null,
    servedAt: null,
    updatedAt: "2026-10-30T09:00:00.000Z",
    prepTimeMin: 6,
  };
}

function state(): HubState {
  const snapshot: HubSnapshot = {
    generatedAt: "2026-10-30T09:00:00.000Z",
    hotel: { id: "h1", name: "Spice", slug: "spice", timezone: "Asia/Kolkata" },
    passKey: "k",
    menu: {
      hotel: { id: "h1", name: "Spice", slug: "spice", currency: "INR", timezone: "Asia/Kolkata", defaultLanguage: "en", pricesIncludeTax: false, allowPayLater: true, allowPayNow: false, upiEnabled: false },
      categories: [],
      items: [
        { id: "naan", categoryId: "c", name: "Naan", description: null, translations: null, imageUrl: null, price: 6000, foodType: "VEG", spiceLevel: null, prepTimeMin: 6, isBestseller: false, isAvailable: true, variants: [], addonGroupIds: [] },
        { id: "dal", categoryId: "c", name: "Dal", description: null, translations: null, imageUrl: null, price: 20000, foodType: "VEG", spiceLevel: null, prepTimeMin: 15, isBestseller: false, isAvailable: false, variants: [], addonGroupIds: [] },
      ],
      addonGroups: [],
      version: "v",
    },
    stations: [{ id: "tandoor", name: "Tandoor", color: null }],
    menuItems: [
      { id: "naan", name: "Naan", isAvailable: true, stationId: "tandoor", categoryId: "c" },
      { id: "dal", name: "Dal", isAvailable: false, stationId: "kitchen", categoryId: "c" },
    ],
    staff: [],
    tables: [
      { id: "t1", label: "T1", floor: null, status: "OCCUPIED", session: { id: "s1", joinCode: "1234", isConfirmed: true, guestCount: 2, openedAt: "2026-10-30T08:00:00.000Z" } },
      { id: "t2", label: "T2", floor: null, status: "FREE", session: null },
    ],
    assignments: { t1: ["waiter-1"] },
    orders: [
      {
        id: "o1",
        sessionId: "s1",
        tableLabel: "T1",
        orderNumber: 7,
        source: "QR_CUSTOMER",
        status: "PLACED",
        note: null,
        etaAt: null,
        placedAt: "2026-10-30T09:00:00.000Z",
        items: [item("i1", "QUEUED"), item("i2", "QUEUED", "kitchen")],
      },
    ],
    pendingOrders: [],
    requests: [{ id: "r1", sessionId: "s1", tableLabel: "T1", type: "WATER", note: null, status: "OPEN", createdAt: "2026-10-30T09:00:00.000Z" }],
  };
  return { ...emptyState(), snapshot };
}

describe("hub state", () => {
  it("applies kitchen work locally, queues it once, and ignores a device re-sending its queue", () => {
    const s = state();
    const start = q({ type: "item.transition", orderItemId: "i1", to: "COOKING" });
    const r = applyCommand(s, cook, start);
    expect(r.outcome).toBe("APPLIED");
    expect(r.events.map((e) => e.event)).toEqual(["item:status_changed"]);
    expect(s.snapshot!.orders[0]!.items[0]!.status).toBe("COOKING");
    expect(s.snapshot!.orders[0]!.status).toBe("IN_PROGRESS");
    expect(s.outbox).toEqual([{ ...start, staffId: "cook-1" }]);
    expect(applyCommand(s, cook, start).outcome).toBe("NOOP"); // same clientId again
    expect(s.outbox).toHaveLength(1);
  });

  it("enforces the same status rules as the cloud: forward only, by role", () => {
    const s = state();
    expect(applyCommand(s, cook, q({ type: "item.transition", orderItemId: "i1", to: "SERVED" })).outcome).toBe("REJECTED");
    expect(applyCommand(s, cook, q({ type: "item.transition", orderItemId: "i1", to: "READY" })).outcome).toBe("APPLIED");
    expect(applyCommand(s, cook, q({ type: "item.transition", orderItemId: "i1", to: "COOKING" })).outcome).toBe("NOOP"); // stale
    expect(s.snapshot!.orders[0]!.items[0]!.readyAt).not.toBeNull();
    expect(s.outbox).toHaveLength(1); // refusals and no-ops aren't queued
  });

  it("queues commands for items it has never seen, for the cloud to decide", () => {
    const s = state();
    expect(applyCommand(s, cook, q({ type: "item.transition", orderItemId: "unknown", to: "COOKING" })).outcome).toBe("APPLIED");
    expect(s.outbox).toHaveLength(1);
  });

  it("waiter order on a free table: priced from the menu, local number, ids kept for the cloud", () => {
    const s = state();
    const create = q({ type: "order.create", tableId: "t2", lines: [{ id: "11111111-1111-4111-8111-111111111111", itemId: "naan", addonIds: [], quantity: 3 }] });
    const r = applyCommand(s, waiter, create);
    expect(r.outcome).toBe("APPLIED");
    expect(r.events.map((e) => e.event)).toEqual(["table:status_changed", "order:placed"]);
    const ticket = s.snapshot!.orders.at(-1)!;
    expect(ticket).toMatchObject({ id: create.clientId, tableLabel: "T2", orderNumber: LOCAL_ORDER_BASE + 1, status: "PLACED" });
    expect(ticket.items[0]).toMatchObject({ id: "11111111-1111-4111-8111-111111111111", unitPrice: 6000, quantity: 3, stationId: "tandoor" });
    expect(kdsView(s.snapshot!, "tandoor").map((t) => t.tableLabel)).toContain("T2");
    // sold-out dish can't be ordered
    const dal = q({ type: "order.create", tableId: "t1", lines: [{ id: "22222222-2222-4222-8222-222222222222", itemId: "dal", addonIds: [], quantity: 1 }] });
    expect(applyCommand(s, waiter, dal)).toMatchObject({ outcome: "REJECTED" });
  });

  it("availability: last writer wins by device time", () => {
    const s = state();
    const later = new Date("2026-10-30T12:05:00Z").toISOString();
    const earlier = new Date("2026-10-30T12:01:00Z").toISOString();
    expect(applyCommand(s, cook, q({ type: "menu.availability", menuItemId: "naan", isAvailable: false }, later)).outcome).toBe("APPLIED");
    expect(applyCommand(s, cook, q({ type: "menu.availability", menuItemId: "naan", isAvailable: true }, earlier)).outcome).toBe("NOOP");
    expect(s.snapshot!.menu.items[0]!.isAvailable).toBe(false);
  });

  it("views: kitchen per station, waiter board per assignment", () => {
    const s = state();
    expect(kdsView(s.snapshot!, "tandoor")[0]!.items.map((i) => i.id)).toEqual(["i1"]);
    expect(kdsView(s.snapshot!, null)[0]!.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    applyCommand(s, cook, q({ type: "item.transition", orderItemId: "i1", to: "READY" }));
    const board = boardView(s.snapshot!, "waiter-1");
    expect(board.tables.map((t) => t.label)).toEqual(["T1"]);
    expect(board.ready.map((i) => [i.id, i.orderNumber])).toEqual([["i1", 7]]);
    applyCommand(s, waiter, q({ type: "request.done", requestId: "r1" }));
    expect(boardView(s.snapshot!, "waiter-1").requests).toEqual([]);
  });

  it("refuses everything until the first snapshot arrives", () => {
    expect(applyCommand(emptyState(), cook, q({ type: "order.bump", orderId: "o1" })).outcome).toBe("REJECTED");
  });
});
