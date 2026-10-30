import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { unscopedDb } from "@rms/db";
import type { HubHealth, HubPass, KdsTicket, OrderView, SyncResult, WaiterBoard } from "@rms/contracts";
import { createHub } from "@rms/hub";
import { closeQueue } from "../src/jobs/queue";
import { Client, cid, createHotel, createPlatformAdmin, getApp, resetDb, staffOnDevice } from "./helpers";

type Hub = Awaited<ReturnType<typeof createHub>>;

/**
 * The outage story end to end: real cloud API on a port, real hub process logic.
 * The internet drops → kitchen and waiter keep working on the hub → the hub restarts mid-outage →
 * the internet returns → everything lands in the cloud exactly once.
 */
describe("local hub during an internet outage", () => {
  let app: FastifyInstance;
  let cloudUrl: string;
  let dir: string;
  let hubToken: string;
  let hub: Hub;
  let hubUrl: string;
  let cookPass: string;
  let waiterPass: string;
  let tableId: string;
  let naanId: string;
  let guestOrder: OrderView;

  const startHub = async (url: string) => {
    const h = await createHub({ cloudUrl: url, token: hubToken, dataFile: path.join(dir, "state.json"), origins: [], pollMs: 60_000 });
    const address = await h.start(0, "127.0.0.1");
    return { h, address };
  };
  const call = async <T>(pass: string, method: "GET" | "POST", p: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${hubUrl}${p}`, {
      method,
      headers: { authorization: `Bearer ${pass}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  };
  const sync = (pass: string, command: object) =>
    call<SyncResult>(pass, "POST", "/v1/s/sync", { commands: [{ clientId: cid(), clientTs: new Date().toISOString(), command }] });

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    cloudUrl = await app.listen({ port: 0, host: "127.0.0.1" });
    dir = await mkdtemp(path.join(tmpdir(), "rms-hub-"));

    const admin = await createPlatformAdmin(app);
    const { owner } = await createHotel(app, admin, "hub-hotel");
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Breads" });
    naanId = (await owner.ok<{ id: string }>("POST", "/v1/admin/items", { categoryId: cat.id, name: "Naan", price: 6000 })).id;
    const table = await owner.ok<{ id: string; qrToken: string }>("POST", "/v1/admin/tables", { label: "L1" });
    tableId = (await owner.ok<{ id: string }>("POST", "/v1/admin/tables", { label: "L2" })).id;
    const cookId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Cook", role: "COOK", pin: "3001" })).id;
    const waiterId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Waiter", role: "WAITER", pin: "4001" })).id;
    const cook = await staffOnDevice(owner, "KDS", cookId, "3001");
    const waiter = await staffOnDevice(owner, "WAITER", waiterId, "4001");

    hubToken = (await owner.ok<{ token: string }>("POST", "/v1/admin/hub", { url: "http://127.0.0.1:4100" })).token;
    cookPass = (await cook.ok<HubPass>("GET", "/v1/s/hub/pass")).pass!;
    waiterPass = (await waiter.ok<HubPass>("GET", "/v1/s/hub/pass")).pass!;

    // a guest orders while everything is online
    const guest = new Client(app);
    await guest.ok("POST", "/v1/p/sessions/join", { qrToken: table.qrToken, deviceId: "hub-it-guest-01", name: "Ira" });
    await guest.ok("PUT", "/v1/p/cart/items/hub-it-cart-001", { itemId: naanId, quantity: 2 });
    guestOrder = await guest.ok<OrderView>("POST", "/v1/p/orders", { clientId: cid(), payment: "PAY_LATER" });

    ({ h: hub, address: hubUrl } = await startHub(cloudUrl));
  });

  afterAll(async () => {
    await hub?.close();
    await app.close();
    await closeQueue();
    await rm(dir, { recursive: true, force: true });
  });

  it("mirrors the cloud while online", async () => {
    const health = (await (await fetch(`${hubUrl}/hub/health`)).json()) as HubHealth;
    expect(health).toMatchObject({ cloudOnline: true, pending: 0 });
    const tickets = await call<KdsTicket[]>(cookPass, "GET", "/v1/s/kds");
    expect(tickets.map((t) => t.id)).toEqual([guestOrder.id]);
    expect((await fetch(`${hubUrl}/v1/s/kds`)).status).toBe(401); // pass required
    expect((await fetch(`${hubUrl}/v1/s/bills/live`, { headers: { authorization: `Bearer ${cookPass}` } })).status).toBe(503); // needs internet
  });

  it("keeps the kitchen and floor working through an outage and a hub restart, then replays exactly once", async () => {
    hub.link.setCloudUrl("http://127.0.0.1:9"); // internet down
    await hub.link.tick();
    expect(hub.link.online).toBe(false);

    const itemId = guestOrder.items[0]!.id;
    expect((await sync(cookPass, { type: "item.transition", orderItemId: itemId, to: "COOKING" })).results[0]!.outcome).toBe("APPLIED");
    await sync(cookPass, { type: "item.transition", orderItemId: itemId, to: "READY" });
    const board = await call<WaiterBoard>(waiterPass, "GET", "/v1/s/waiter/board");
    expect(board.ready.map((i) => i.id)).toEqual([itemId]);
    await sync(waiterPass, { type: "item.transition", orderItemId: itemId, to: "PICKED_UP" });

    // the waiter takes a new order at another table; the kitchen sees it and starts cooking
    const lineId = randomUUID();
    await sync(waiterPass, { type: "order.create", tableId, lines: [{ id: lineId, itemId: naanId, addonIds: [], quantity: 1 }] });
    const kds = await call<KdsTicket[]>(cookPass, "GET", "/v1/s/kds");
    expect(kds.find((t) => t.tableLabel === "L2")?.orderNumber).toBeGreaterThan(9000);
    await sync(cookPass, { type: "item.transition", orderItemId: lineId, to: "COOKING" });
    expect((await sync(cookPass, { type: "item.transition", orderItemId: lineId, to: "SERVED" })).results[0]!.outcome).toBe("REJECTED");

    // nothing reached the cloud yet
    expect((await unscopedDb.orderItem.findUniqueOrThrow({ where: { id: itemId } })).status).toBe("QUEUED");

    // the hub box reboots mid-outage: the queue survives on disk
    await hub.close();
    ({ h: hub, address: hubUrl } = await startHub("http://127.0.0.1:9"));
    expect(((await (await fetch(`${hubUrl}/hub/health`)).json()) as HubHealth).pending).toBe(5);

    // internet back: one tick replays everything, in order, as the right people
    hub.link.setCloudUrl(cloudUrl);
    await hub.link.tick();
    expect(hub.link.online).toBe(true);
    expect(((await (await fetch(`${hubUrl}/hub/health`)).json()) as HubHealth).pending).toBe(0);

    const guestItem = await unscopedDb.orderItem.findUniqueOrThrow({ where: { id: itemId }, include: { pickedUpBy: true } });
    expect(guestItem.status).toBe("PICKED_UP");
    expect(guestItem.pickedUpBy?.name).toBe("Waiter");
    const lanItem = await unscopedDb.orderItem.findUniqueOrThrow({ where: { id: lineId }, include: { order: { include: { takenBy: true } } } });
    expect(lanItem.status).toBe("COOKING");
    expect(lanItem.order.takenBy?.name).toBe("Waiter");
    expect(lanItem.order.orderNumber).toBeLessThan(9000); // the cloud gave it a real number

    // after the replay the hub's view is the cloud's again (real order number on the kitchen screen)
    const after = await call<KdsTicket[]>(cookPass, "GET", "/v1/s/kds");
    expect(after.find((t) => t.tableLabel === "L2")?.orderNumber).toBe(lanItem.order.orderNumber);
  });
});
