import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { unscopedDb } from "@rms/db";
import type { OrderView, PushPayload, SessionView } from "@rms/contracts";
import { closeQueue, redis } from "../src/jobs/queue";
import { pushTransport, type PushResult } from "../src/lib/push";
import { sweepAll, sweepHotel } from "../src/services/alerts";
import { Client, cid, createHotel, createPlatformAdmin, getApp, resetDb, staffOnDevice } from "./helpers";

describe("phone alerts", () => {
  let app: FastifyInstance;
  let owner: Client;
  let hotelId: string;
  let table: { id: string; qrToken: string };
  let naan: string;
  let cook: Client;
  let waiter: Client;
  let waiter2: Client;
  let cashier: Client;
  let manager: Client;
  const ids: Record<string, string> = {};
  const original = pushTransport.send;
  let rung: { who: string; payload: PushPayload }[] = [];
  let answer: PushResult = "SENT";

  const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
  const endpoint = (who: string) => `https://fcm.googleapis.com/fcm/send/${who}`;
  const subscribe = (c: Client, who: string) => c.ok<{ paused: boolean }>("POST", "/v1/s/push", { endpoint: endpoint(who), keys });
  const sweep = async () => {
    rung = [];
    await sweepHotel(hotelId);
    return rung.map((r) => r.who).sort();
  };
  /** Time passes for the repeat timer only. */
  const repeatDue = async () => {
    const k = await redis.keys("alerts:pace:*");
    if (k.length) await redis.del(...k);
  };
  const later = async (min: number) => {
    const at = new Date(Date.now() - min * 60_000);
    await unscopedDb.order.updateMany({ where: { hotelId }, data: { placedAt: at } });
    await unscopedDb.orderItem.updateMany({ where: { hotelId, readyAt: { not: null } }, data: { readyAt: at } });
    for (const k of await redis.keys("alerts:seen:*")) await redis.set(k, String(at.getTime()));
    await repeatDue();
  };
  const place = () => owner.ok<OrderView>("POST", "/v1/s/orders", { clientId: cid(), tableId: table.id, lines: [{ itemId: naan, quantity: 1 }] });
  const move = (c: Client, o: OrderView, to: string) => c.ok("POST", `/v1/s/order-items/${o.items[0]!.id}/transition`, { clientId: cid(), to });

  beforeAll(async () => {
    app = await getApp();
    await resetDb();
    const admin = await createPlatformAdmin(app);
    ({ owner, hotelId } = await createHotel(app, admin, "alerts-hotel"));
    table = await owner.ok("POST", "/v1/admin/tables", { label: "A1" });
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Breads" });
    naan = (await owner.ok<{ id: string }>("POST", "/v1/admin/items", { categoryId: cat.id, name: "Naan", price: 5000, foodType: "VEG" })).id;
    const mk = async (name: string, role: string, pin: string) => (ids[name] = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name, role, pin })).id);
    await mk("cook", "COOK", "3001");
    await mk("waiter", "WAITER", "4001");
    await mk("waiter2", "WAITER", "4002");
    await mk("cashier", "CASHIER", "2000");
    await mk("manager", "MANAGER", "100000");
    cook = await staffOnDevice(owner, "KDS", ids.cook!, "3001");
    waiter = await staffOnDevice(owner, "WAITER", ids.waiter!, "4001");
    waiter2 = await staffOnDevice(owner, "WAITER", ids.waiter2!, "4002");
    cashier = await staffOnDevice(owner, "POS", ids.cashier!, "2000");
    manager = await staffOnDevice(owner, "POS", ids.manager!, "100000");
    pushTransport.send = async (t, payload) => {
      rung.push({ who: t.endpoint.split("/").at(-1) ?? "", payload });
      return answer;
    };
    for (const [who, c] of Object.entries({ cook, waiter, waiter2, cashier, manager })) await subscribe(c, who);
  });

  beforeEach(async () => {
    answer = "SENT";
    for (const k of await redis.keys("alerts:*")) await redis.del(k);
  });
  afterEach(async () => {
    // nothing left waiting for the next test
    await unscopedDb.orderItem.updateMany({ where: { hotelId }, data: { status: "SERVED" } });
    await unscopedDb.order.updateMany({ where: { hotelId }, data: { status: "SERVED" } });
    await unscopedDb.serviceRequest.updateMany({ where: { hotelId }, data: { status: "DONE" } });
  });
  afterAll(async () => {
    pushTransport.send = original;
    await app.close();
    await closeQueue();
  });

  it("a new order rings the cook at once, again until they start it, then stops", async () => {
    const o = await place();
    expect(await sweep()).toEqual(["cook"]);
    expect(rung[0]?.payload).toMatchObject({ title: "New order", url: "/kds/" });
    expect(rung[0]?.payload.body).toContain("A1");
    expect(await sweep()).toEqual([]); // not due yet
    await repeatDue();
    expect(await sweep()).toEqual(["cook"]);
    await place(); // something new rings at once, without waiting for the repeat
    expect(await sweep()).toEqual(["cook"]);
    expect(rung[0]?.payload.title).toBe("2 waiting");
    await move(cook, o, "COOKING");
    await unscopedDb.orderItem.updateMany({ where: { hotelId, status: "QUEUED" }, data: { status: "COOKING" } });
    await repeatDue();
    expect(await sweep()).toEqual([]);
  });

  it("nobody starts it: managers ring too after 2 minutes; after 30 it is a forgotten tap", async () => {
    await place();
    await sweep();
    await later(3);
    expect(await sweep()).toEqual(["cook", "manager"]);
    await later(31);
    expect(await sweep()).toEqual([]);
  });

  it("food ready rings the table's own waiter, then every waiter and the manager", async () => {
    await owner.ok("PUT", "/v1/admin/assignments", { assignments: [{ tableId: table.id, staffId: ids.waiter }] });
    const o = await place();
    await move(cook, o, "READY");
    expect(await sweep()).toEqual(["waiter"]);
    await later(3);
    expect(await sweep()).toEqual(["manager", "waiter", "waiter2"]);
    await move(waiter2, o, "PICKED_UP");
    await repeatDue();
    expect(await sweep()).toEqual([]);
    await owner.ok("PUT", "/v1/admin/assignments", { assignments: [] });
  });

  it("the assigned waiter can't be reached: everyone else rings straight away", async () => {
    await owner.ok("PUT", "/v1/admin/assignments", { assignments: [{ tableId: table.id, staffId: ids.waiter }] });
    await waiter.ok("POST", "/v1/s/push/pause", { endpoint: endpoint("waiter"), paused: true });
    const o = await place();
    await move(cook, o, "READY");
    expect(await sweep()).toEqual(["manager", "waiter2"]);
    expect((await subscribe(waiter, "waiter")).paused).toBe(true); // reopening the app keeps "off duty"
    await waiter.ok("POST", "/v1/s/push/pause", { endpoint: endpoint("waiter"), paused: false });
    await owner.ok("PUT", "/v1/admin/assignments", { assignments: [] });
  });

  it("guest requests ring waiters; a bill request rings the cashier too; no guest details on the lock screen", async () => {
    const g = new Client(app);
    const { joinCode } = await unscopedDb.tableSession.findFirstOrThrow({ where: { hotelId, status: "OPEN" } });
    await g.ok<{ session: SessionView }>("POST", "/v1/p/sessions/join", { qrToken: table.qrToken, deviceId: "alert-guest-1", name: "Secretname", joinCode });
    await g.ok("POST", "/v1/p/requests", { clientId: cid(), type: "WATER" });
    expect(await sweep()).toEqual(["waiter", "waiter2"]);
    await g.ok("POST", "/v1/p/requests", { clientId: cid(), type: "BILL" });
    expect(await sweep()).toEqual(["cashier", "waiter", "waiter2"]);
    expect(JSON.stringify(rung)).not.toContain("Secretname");
  });

  it("managers see whose phone will ring; a dead subscription is dropped", async () => {
    const on = async (id: string) => (await owner.ok<{ id: string; alertsOn: boolean }[]>("GET", "/v1/admin/staff")).find((s) => s.id === id)?.alertsOn;
    expect(await on(ids.cook!)).toBe(true);
    await place();
    answer = "GONE";
    expect(await sweep()).toEqual(["cook"]);
    expect(await on(ids.cook!)).toBe(false);
    answer = "SENT";
    await subscribe(cook, "cook");
  });

  it("a shared phone rings only who is signed in now; signing out or being removed stops it", async () => {
    const phone = await staffOnDevice(owner, "WAITER", ids.waiter!, "4001");
    await subscribe(phone, "shared");
    await phone.ok("POST", "/v1/auth/logout");
    expect(await unscopedDb.pushSubscription.count({ where: { endpoint: endpoint("shared") } })).toBe(0);
    await phone.ok("POST", "/v1/auth/pin", { staffId: ids.waiter2, pin: "4002" });
    await subscribe(phone, "shared");
    expect((await unscopedDb.pushSubscription.findUniqueOrThrow({ where: { endpoint: endpoint("shared") } })).staffId).toBe(ids.waiter2);
    // signed out from elsewhere (tokens revoked): the row is still there but never rings
    await unscopedDb.refreshToken.updateMany({ where: { subjectId: ids.waiter2 }, data: { revokedAt: new Date() } });
    const o = await place();
    await move(cook, o, "READY");
    expect(await sweep()).toEqual(["waiter"]);
  });

  it("only real push services are accepted, only your own subscription can be changed", async () => {
    for (const bad of ["http://fcm.googleapis.com/x", "https://localhost/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.test/x", "https://fcm.googleapis.com:8443/x", "https://u:p@fcm.googleapis.com/x", "nope"]) {
      expect((await cook.req("POST", "/v1/s/push", { endpoint: bad, keys })).statusCode).toBe(400);
    }
    expect((await cashier.req("POST", "/v1/s/push/pause", { endpoint: endpoint("cook"), paused: true })).statusCode).toBe(404);
    expect((await new Client(app).req("GET", "/v1/s/push/key")).statusCode).toBe(401);
    const { publicKey } = await cook.ok<{ publicKey: string }>("GET", "/v1/s/push/key");
    expect(Buffer.from(publicKey, "base64url")).toHaveLength(65);
  });

  it("the sweep over all restaurants rings too", async () => {
    await place();
    rung = [];
    await sweepAll();
    expect(rung.map((r) => r.who)).toEqual(["cook"]);
  });

  it("a paired phone that lost the answer to a refresh stays signed in; a used successor still means theft", async () => {
    const phone = await staffOnDevice(owner, "WAITER", ids.waiter!, "4001");
    const copy = () => {
      const c = new Client(app);
      for (const [k, v] of phone.cookies) c.cookies.set(k, v);
      return c;
    };
    const age = () => unscopedDb.refreshToken.updateMany({ where: { subjectId: ids.waiter, revokedAt: { not: null } }, data: { revokedAt: new Date(Date.now() - 3600_000) } });
    const old = copy();
    await copy().ok("POST", "/v1/auth/refresh"); // the answer never reached the phone
    await age();
    await old.ok("POST", "/v1/auth/refresh"); // an hour later, with the old token
    expect((await old.req("GET", "/v1/s/waiter/board")).statusCode).toBe(200);
    // without the device's own cookie, or once the newer token was used, it is refused as before
    await age();
    const thief = copy();
    thief.cookies.delete("rms_dev");
    expect((await thief.req("POST", "/v1/auth/refresh")).statusCode).toBe(401);
  });
});
