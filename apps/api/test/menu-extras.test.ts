import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { PublicMenu } from "@rms/contracts";
import { closeQueue } from "../src/jobs/queue";
import { isGlb } from "../src/lib/storage";
import { Client, createHotel, createPlatformAdmin, getApp, resetDb } from "./helpers";

/** Smallest valid binary glTF 2.0: 12-byte header + an empty JSON chunk. */
function tinyGlb(): Buffer {
  const json = Buffer.from('{"asset":{"version":"2.0"}}  '); // padded to a multiple of 4
  const b = Buffer.alloc(12 + 8 + json.length);
  b.write("glTF", 0, "ascii");
  b.writeUInt32LE(2, 4);
  b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(json.length, 12);
  b.write("JSON", 16, "ascii");
  json.copy(b, 20);
  return b;
}

describe("menu extras: smart tags, 3D models, Google review card, billing cycles", () => {
  let app: FastifyInstance;
  let admin: Client;
  let owner: Client;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    admin = await createPlatformAdmin(app);
    ({ owner } = await createHotel(app, admin, "extras"));
  });
  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  const upload = (body: Buffer, name = "dish.glb") => {
    const boundary = "----glb";
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: model/gltf-binary\r\n\r\n`),
      body,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: "POST",
      url: "/v1/admin/uploads/model",
      payload,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: `rms_at=${owner.cookies.get("rms_at")}` },
    });
  };

  it("tags are validated, de-duplicated and put in display order; guests see them and isBestseller", async () => {
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Mains" });
    expect((await owner.req("POST", "/v1/admin/items", { categoryId: cat.id, name: "X", price: 100, tags: ["FREE_BEER"] })).statusCode).toBe(400);
    const item = await owner.ok<{ id: string; tags: string[] }>("POST", "/v1/admin/items", {
      categoryId: cat.id,
      name: "Thali",
      price: 25000,
      tags: ["SPICY", "BESTSELLER", "CHEFS_CHOICE", "SPICY"],
    });
    expect(item.tags).toEqual(["BESTSELLER", "CHEFS_CHOICE", "SPICY"]);
    const menu = await new Client(app).ok<PublicMenu>("GET", "/v1/p/h/extras/menu");
    expect(menu.items[0]).toMatchObject({ tags: ["BESTSELLER", "CHEFS_CHOICE", "SPICY"], isBestseller: true, modelUrl: null });
  });

  it("3D models: only real .glb files are stored; the dish then offers a 3D view", async () => {
    expect(isGlb(tinyGlb())).toBe(true);
    const wrongLength = tinyGlb();
    wrongLength.writeUInt32LE(9999, 8);
    expect(isGlb(wrongLength)).toBe(false);

    const bad = await upload(Buffer.from("<html><script>alert(1)</script></html>"));
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("BAD_MODEL");

    const ok = await upload(tinyGlb());
    expect(ok.statusCode).toBe(201);
    const url = ok.json().url as string;
    expect(url).toMatch(/\.glb$/);

    const items = await owner.ok<{ id: string }[]>("GET", "/v1/admin/items");
    await owner.ok("PATCH", `/v1/admin/items/${items[0]!.id}`, { modelUrl: url });
    const menu = await new Client(app).ok<PublicMenu>("GET", "/v1/p/h/extras/menu");
    expect(menu.items[0]!.modelUrl).toBe(url);
    // a javascript: URL can never be saved as a model
    expect((await owner.req("PATCH", `/v1/admin/items/${items[0]!.id}`, { modelUrl: "javascript:alert(1)" })).statusCode).toBe(400);
  });

  it("Google review card: only Google links are accepted and the public link resolves to it", async () => {
    const guest = new Client(app);
    expect(await guest.ok("GET", "/v1/p/h/extras/review")).toEqual({ url: null });
    for (const url of ["https://evil.example/r", "http://g.page/r/abc", "https://g.page.evil.example/r", "javascript:alert(1)"]) {
      const r = await owner.req("PATCH", "/v1/admin/hotel", { googleReviewUrl: url });
      expect(r.statusCode, url).toBe(400);
    }
    await owner.ok("PATCH", "/v1/admin/hotel", { googleReviewUrl: "https://g.page/r/CabcDEF123/review" });
    expect(await guest.ok("GET", "/v1/p/h/extras/review")).toEqual({ url: "https://g.page/r/CabcDEF123/review" });
    expect((await guest.ok<PublicMenu>("GET", "/v1/p/h/extras/menu")).hotel.reviewEnabled).toBe(true);
    expect((await guest.req("GET", "/v1/p/h/nope/review")).statusCode).toBe(404);
  });

  it("plans offer monthly / quarterly / yearly prices and each restaurant has a billing cycle", async () => {
    const plan = await admin.ok<{ id: string }>("POST", "/v1/platform/plans", { name: "Growth", priceMonthly: 100000, maxTables: 20, maxStaff: 20, features: {} });
    const patched = await admin.ok<Record<string, unknown>>("PATCH", `/v1/platform/plans/${plan.id}`, { priceQuarterly: 270000, priceYearly: 960000 });
    expect(patched).toMatchObject({ priceMonthly: 100000, priceQuarterly: 270000, priceYearly: 960000, maxTables: 20 });
    const hotels = await admin.ok<{ id: string; slug: string; billingCycle: string }[]>("GET", "/v1/platform/hotels");
    const h = hotels.find((x) => x.slug === "extras")!;
    expect(h.billingCycle).toBe("MONTHLY");
    await admin.ok("PATCH", `/v1/platform/hotels/${h.id}`, { planId: plan.id, billingCycle: "QUARTERLY" });
    expect((await admin.ok<{ id: string; billingCycle: string }[]>("GET", "/v1/platform/hotels")).find((x) => x.id === h.id)!.billingCycle).toBe("QUARTERLY");
    expect((await admin.req("PATCH", `/v1/platform/hotels/${h.id}`, { billingCycle: "WEEKLY" })).statusCode).toBe(400);
    // restaurant owners can't change plans
    expect((await owner.req("PATCH", `/v1/platform/plans/${plan.id}`, { priceMonthly: 1 })).statusCode).toBe(403);
  });
});
