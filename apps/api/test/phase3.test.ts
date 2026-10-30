import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { jwtVerify } from "jose";
import { unscopedDb } from "@rms/db";
import type { AuditPage, HubPass, HubSnapshot, OrderView, QueuedCommand, SyncResult, SyncRejectionView } from "@rms/contracts";
import { closeQueue } from "../src/jobs/queue";
import { Client, cid, createHotel, createPlatformAdmin, getApp, resetDb, staffOnDevice } from "./helpers";

/** Phase 3: device offline queue (/v1/s/sync), local hub (pair, pass, snapshot, replay), audit log. */
describe("offline sync, local hub, audit", () => {
  let app: FastifyInstance;
  let owner: Client;
  let cook: Client;
  let waiter: Client;
  let waiterId: string;
  let cookId: string;
  let naanId: string;
  let tableId: string;
  let qrToken: string;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    const admin = await createPlatformAdmin(app);
    ({ owner } = await createHotel(app, admin, "phase-three"));
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Breads" });
    naanId = (await owner.ok<{ id: string }>("POST", "/v1/admin/items", { categoryId: cat.id, name: "Naan", price: 6000 })).id;
    ({ id: tableId, qrToken } = await owner.ok<{ id: string; qrToken: string }>("POST", "/v1/admin/tables", { label: "H1" }));
    cookId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Cook", role: "COOK", pin: "3001" })).id;
    waiterId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Waiter", role: "WAITER", pin: "4001" })).id;
    cook = await staffOnDevice(owner, "KDS", cookId, "3001");
    waiter = await staffOnDevice(owner, "WAITER", waiterId, "4001");
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  const at = (minsAgo = 0) => new Date(Date.now() - minsAgo * 60_000).toISOString();
  const cmd = (command: QueuedCommand["command"], clientTs = at()): QueuedCommand => ({ clientId: cid(), clientTs, command });

  it("device queue: a waiter's offline order, then the cook's offline work, replays in order and safely twice", async () => {
    const lineId = randomUUID();
    const create = cmd({ type: "order.create", tableId, lines: [{ id: lineId, itemId: naanId, addonIds: [], quantity: 2 }] });
    const r1 = await waiter.ok<SyncResult>("POST", "/v1/s/sync", { commands: [create] });
    expect(r1.results).toEqual([{ clientId: create.clientId, outcome: "APPLIED" }]);
    // the item id the waiter's phone generated is the real id, so later commands can refer to it
    const item = await unscopedDb.orderItem.findUniqueOrThrow({ where: { id: lineId } });
    expect(item.quantity).toBe(2);

    const cooking = [cmd({ type: "item.transition", orderItemId: lineId, to: "COOKING" }), cmd({ type: "item.transition", orderItemId: lineId, to: "READY" })];
    const r2 = await cook.ok<SyncResult>("POST", "/v1/s/sync", { commands: cooking });
    expect(r2.results.map((r) => r.outcome)).toEqual(["APPLIED", "APPLIED"]);

    // the same queue flushed again (lost response) changes nothing and opens no new session
    const again = await cook.ok<SyncResult>("POST", "/v1/s/sync", { commands: cooking });
    expect(again.results.map((r) => r.outcome)).toEqual(["NOOP", "NOOP"]);
    expect((await waiter.ok<SyncResult>("POST", "/v1/s/sync", { commands: [create] })).results[0]!.outcome).toBe("NOOP");
    expect(await unscopedDb.order.count()).toBe(1);

    // a cook can't serve: refused, recorded for the manager, and the rest of the queue still runs
    const bad = cmd({ type: "item.transition", orderItemId: lineId, to: "SERVED" });
    const pickup = cmd({ type: "item.transition", orderItemId: lineId, to: "PICKED_UP" });
    const r3 = await cook.ok<SyncResult>("POST", "/v1/s/sync", { commands: [bad] });
    expect(r3.results[0]).toMatchObject({ outcome: "REJECTED" });
    expect((await waiter.ok<SyncResult>("POST", "/v1/s/sync", { commands: [pickup] })).results[0]!.outcome).toBe("APPLIED");
    const rejections = await owner.ok<SyncRejectionView[]>("GET", "/v1/admin/sync-rejections");
    expect(rejections.map((r) => r.clientId)).toContain(bad.clientId);
  });

  it("guest checkout never adopts the phone's cart line ids as order item ids", async () => {
    const table = await owner.ok<{ qrToken: string }>("POST", "/v1/admin/tables", { label: "H9" });
    const guest = new Client(app);
    await guest.ok("POST", "/v1/p/sessions/join", { qrToken: table.qrToken, deviceId: "id-leak-guest-01", name: "Lia" });
    const lineId = randomUUID();
    await guest.ok("PUT", `/v1/p/cart/items/${lineId}`, { itemId: naanId, quantity: 1 });
    const order = await guest.ok<OrderView>("POST", "/v1/p/orders", { clientId: cid(), payment: "PAY_LATER" });
    expect(order.items[0]!.id).not.toBe(lineId);
  });

  it("availability toggles: last writer wins by device time", async () => {
    await cook.ok("PATCH", `/v1/s/menu-items/${naanId}/availability`, { isAvailable: false }); // now, online
    const stale = cmd({ type: "menu.availability", menuItemId: naanId, isAvailable: true }, at(10)); // made offline 10 min ago
    expect((await cook.ok<SyncResult>("POST", "/v1/s/sync", { commands: [stale] })).results[0]!.outcome).toBe("NOOP");
    expect((await unscopedDb.menuItem.findUniqueOrThrow({ where: { id: naanId } })).isAvailable).toBe(false);
    const fresh = cmd({ type: "menu.availability", menuItemId: naanId, isAvailable: true }, new Date(Date.now() + 1000).toISOString());
    expect((await cook.ok<SyncResult>("POST", "/v1/s/sync", { commands: [fresh] })).results[0]!.outcome).toBe("APPLIED");
  });

  it("hub: pair, device pass, snapshot, and replay of LAN work after an outage", async () => {
    expect((await waiter.ok<HubPass>("GET", "/v1/s/hub/pass")).pass).toBeNull(); // no hub yet

    const paired = await owner.ok<{ token: string; deviceId: string }>("POST", "/v1/admin/hub", { url: "https://hub.local.test:4100" });
    const hubReq = (method: "GET" | "POST", url: string, body?: unknown) =>
      app.inject({ method, url, headers: { authorization: `Bearer ${paired.token}`, ...(body ? { "content-type": "application/json" } : {}) }, payload: body ? JSON.stringify(body) : undefined });

    expect((await app.inject({ method: "GET", url: "/v1/hub/snapshot", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    expect((await waiter.req("GET", "/v1/hub/snapshot")).statusCode).toBe(401); // staff tokens aren't hub tokens

    // a guest orders while online: the hub's snapshot carries it
    const guest = new Client(app);
    await guest.ok("POST", "/v1/p/sessions/join", { qrToken, deviceId: "hub-guest-00001", name: "Gita", joinCode: (await unscopedDb.tableSession.findFirstOrThrow({ where: { tableId, status: "OPEN" } })).joinCode });
    await guest.ok("PUT", "/v1/p/cart/items/hub-cart-00001", { itemId: naanId, quantity: 1 });
    const order = await guest.ok<OrderView>("POST", "/v1/p/orders", { clientId: cid(), payment: "PAY_LATER" });

    const snap = (await hubReq("GET", "/v1/hub/snapshot")).json() as HubSnapshot;
    expect(snap.staff.map((s) => s.name).sort()).toEqual(["Cook", "Owner", "Waiter"]);
    expect(snap.orders.some((o) => o.id === order.id)).toBe(true);
    expect(snap.tables.find((t) => t.id === tableId)?.session).not.toBeNull();
    expect(snap.menu.items.map((i) => i.name)).toEqual(["Naan"]);
    expect(snap).not.toHaveProperty("staff.0.pinHash");

    // the waiter's device pass verifies with the key the hub got in its snapshot
    const pass = await waiter.ok<HubPass>("GET", "/v1/s/hub/pass");
    expect(pass.hubUrl).toBe("https://hub.local.test:4100");
    const { payload } = await jwtVerify(pass.pass!, new TextEncoder().encode(snap.passKey));
    expect(payload).toMatchObject({ typ: "hubpass", sub: waiterId, role: "WAITER" });

    // outage: cook and waiter work on the hub; it replays as each of them, in order
    const itemId = order.items[0]!.id;
    const replay = [
      { ...cmd({ type: "item.transition", orderItemId: itemId, to: "COOKING" }), staffId: cookId },
      { ...cmd({ type: "item.transition", orderItemId: itemId, to: "READY" }), staffId: cookId },
      { ...cmd({ type: "item.transition", orderItemId: itemId, to: "PICKED_UP" }), staffId: waiterId },
      { ...cmd({ type: "item.transition", orderItemId: itemId, to: "SERVED" }), staffId: cookId }, // cooks can't serve → refused
      { ...cmd({ type: "item.transition", orderItemId: itemId, to: "SERVED" }), staffId: waiterId },
      { ...cmd({ type: "item.transition", orderItemId: itemId, to: "COOKING" }), staffId: "no-such-staff" },
    ];
    const res = (await hubReq("POST", "/v1/hub/sync", { commands: replay })).json() as SyncResult;
    expect(res.results.map((r) => r.outcome)).toEqual(["APPLIED", "APPLIED", "APPLIED", "REJECTED", "APPLIED", "REJECTED"]);
    const final = await unscopedDb.orderItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(final).toMatchObject({ status: "SERVED", pickedUpById: waiterId });

    // replaying the whole batch again (hub didn't get the response) changes nothing
    const twice = (await hubReq("POST", "/v1/hub/sync", { commands: replay })).json() as SyncResult;
    expect(twice.results.map((r) => r.outcome)).toEqual(["NOOP", "NOOP", "NOOP", "NOOP", "NOOP", "REJECTED"]); // already served beats any role check

    // pairing a new hub retires the old token and changes the pass key
    const second = await owner.ok<{ token: string }>("POST", "/v1/admin/hub", { url: "https://hub2.local.test:4100" });
    expect((await hubReq("GET", "/v1/hub/snapshot")).statusCode).toBe(401);
    const snap2 = (await app.inject({ method: "GET", url: "/v1/hub/snapshot", headers: { authorization: `Bearer ${second.token}` } })).json() as HubSnapshot;
    expect(snap2.passKey).not.toBe(snap.passKey);
  });

  it("audit log: newest first, filter by action, cursor paging, actor names", async () => {
    const page = await owner.ok<AuditPage>("GET", "/v1/admin/audit?limit=2");
    expect(page.entries).toHaveLength(2);
    expect(page.next).not.toBeNull();
    expect(page.entries[0]!.action).toBe("HUB_PAIRED");
    expect(page.entries[0]!.actor?.name).toBe("Owner");
    const next = await owner.ok<AuditPage>("GET", `/v1/admin/audit?limit=2&before=${encodeURIComponent(page.next!)}`);
    expect(next.entries.every((e) => e.createdAt <= page.entries[1]!.createdAt)).toBe(true);
    const stock = await owner.ok<AuditPage>("GET", "/v1/admin/audit?action=MENU_AVAILABILITY");
    expect(stock.entries.length).toBeGreaterThanOrEqual(2);
    expect(stock.entries.every((e) => e.action === "MENU_AVAILABILITY" && e.actor?.name === "Cook")).toBe(true);
    expect((await waiter.req("GET", "/v1/admin/audit")).statusCode).toBe(403);
    expect((await owner.req("GET", "/v1/admin/audit?action=NOPE")).statusCode).toBe(400);
  });
});
