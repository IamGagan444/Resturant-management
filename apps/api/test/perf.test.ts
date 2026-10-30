import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { unscopedDb } from "@rms/db";
import { closeQueue } from "../src/jobs/queue";
import { Client, cid, createHotel, createPlatformAdmin, getApp, resetDb, staffOnDevice } from "./helpers";

/**
 * Busy Friday night: 40 occupied tables, ~200 orders, 600 items. Every hot screen must stay fast.
 * Budgets are generous (CI machines vary); the printed timings are what to watch.
 */
describe("performance under a full restaurant", () => {
  let app: FastifyInstance;
  let owner: Client;
  let cook: Client;
  let waiter: Client;
  let cashier: Client;
  let slug: string;
  const TABLES = 40;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    const admin = await createPlatformAdmin(app);
    slug = "perf-hotel";
    ({ owner } = await createHotel(app, admin, slug));
    const taxes = await owner.ok<{ id: string }[]>("GET", "/v1/admin/taxes");
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Mains" });
    const items: string[] = [];
    for (let i = 0; i < 60; i++) {
      items.push((await owner.ok<{ id: string }>("POST", "/v1/admin/items", { categoryId: cat.id, name: `Dish ${i}`, price: 10000 + i * 500, taxIds: taxes.map((t) => t.id) })).id);
    }
    const mk = async (role: string, pin: string) => (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: role, role, pin })).id;
    cook = await staffOnDevice(owner, "KDS", await mk("COOK", "3001"), "3001");
    waiter = await staffOnDevice(owner, "WAITER", await mk("WAITER", "4001"), "4001");
    cashier = await staffOnDevice(owner, "POS", await mk("CASHIER", "2000"), "2000");
    for (let t = 0; t < TABLES; t++) {
      const table = await owner.ok<{ id: string }>("POST", "/v1/admin/tables", { label: `P${t}` });
      for (let o = 0; o < 5; o++) {
        await waiter.ok("POST", "/v1/s/orders", {
          clientId: cid(),
          tableId: table.id,
          lines: [0, 1, 2].map((k) => ({ itemId: items[(t * 7 + o * 3 + k) % items.length]!, quantity: 1 + (k % 2) })),
        });
      }
    }
    expect(await unscopedDb.orderItem.count()).toBe(TABLES * 5 * 3);
  }, 300_000);

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  async function time(c: Client, url: string, runs = 10) {
    await c.ok("GET", url); // warm
    const ms: number[] = [];
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      await c.ok("GET", url);
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    const p50 = ms[Math.floor(runs / 2)]!;
    const max = ms.at(-1)!;
    console.log(`${url.padEnd(28)} p50 ${p50.toFixed(1).padStart(6)} ms   max ${max.toFixed(1).padStart(6)} ms`);
    return p50;
  }

  it("hot endpoints stay within budget", async () => {
    const guest = new Client(app);
    expect(await time(guest, `/v1/p/h/${slug}/menu`)).toBeLessThan(40);
    expect(await time(cook, "/v1/s/kds?station=all")).toBeLessThan(250);
    expect(await time(waiter, "/v1/s/waiter/board")).toBeLessThan(250);
    expect(await time(cashier, "/v1/s/bills/live", 5)).toBeLessThan(1500);
    expect(await time(owner, "/v1/s/floor", 5)).toBeLessThan(1500);
    expect(await time(cashier, "/v1/s/reports/day", 5)).toBeLessThan(500);
  });

  it("big responses are compressed", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/p/h/${slug}/menu`, headers: { "accept-encoding": "gzip" } });
    expect(res.headers["content-encoding"]).toBe("gzip");
  });
});
