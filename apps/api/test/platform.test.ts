import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { unscopedDb } from "@rms/db";
import type { PlatformHotel, PlatformOverview, PlatformSession } from "@rms/contracts";
import { closeQueue } from "../src/jobs/queue";
import { Client, createHotel, createPlatformAdmin, getApp, resetDb } from "./helpers";

/** Super admin: dashboard, restaurant CRUD, owners' sign-ins. */
describe("platform admin", () => {
  let app: FastifyInstance;
  let admin: Client;
  let owner: Client;
  let hotelId: string;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    admin = await createPlatformAdmin(app);
    ({ owner, hotelId } = await createHotel(app, admin, "plat-one"));
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  it("lists restaurants with their owner, and the overview counts them", async () => {
    const list = await admin.ok<PlatformHotel[]>("GET", "/v1/platform/hotels");
    const h = list.find((x) => x.id === hotelId)!;
    expect(h.owner?.email).toBe("owner@plat-one.test");
    const o = await admin.ok<PlatformOverview>("GET", "/v1/platform/overview");
    expect(o.hotels.byStatus.ACTIVE).toBeGreaterThanOrEqual(1);
    expect(o.activity.staffSignedIn).toBeGreaterThanOrEqual(1);
  });

  it("phone numbers typed with spaces are accepted and stored as digits", async () => {
    const s = await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Jeevan", role: "WAITER", pin: "3435", phone: "96926 25911" });
    expect((await unscopedDb.staff.findUniqueOrThrow({ where: { id: s.id } })).phone).toBe("9692625911");
    const bad = await owner.req("POST", "/v1/admin/staff", { name: "X", role: "WAITER", pin: "12", phone: "123" });
    expect(bad.statusCode).toBe(400);
    const details = bad.json().error.details as { fieldErrors: Record<string, string[]> };
    expect(details.fieldErrors.pin?.[0]).toMatch(/PIN/);
    expect(details.fieldErrors.phone?.[0]).toMatch(/mobile/);
  });

  it("shows an owner's sign-in and signing it out stops the owner at once", async () => {
    const sessions = await admin.ok<PlatformSession[]>("GET", `/v1/platform/sessions?hotelId=${hotelId}`);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.person.role).toBe("OWNER");
    expect(sessions[0]!.device).toBeNull();

    expect((await owner.req("GET", "/v1/admin/staff")).statusCode).toBe(200);
    await admin.ok("DELETE", `/v1/platform/sessions/${sessions[0]!.id}`);
    // access token cut immediately, and the refresh token is revoked too
    expect((await owner.req("GET", "/v1/admin/staff")).statusCode).toBe(401);
    expect((await owner.req("POST", "/v1/auth/refresh")).statusCode).toBe(401);
    expect(await admin.ok<PlatformSession[]>("GET", `/v1/platform/sessions?hotelId=${hotelId}`)).toHaveLength(0);
  });

  it("resets an owner's password, edits and suspends the restaurant, then deletes it", async () => {
    const ownerId = (await unscopedDb.staff.findFirstOrThrow({ where: { hotelId, role: "OWNER" } })).id;
    await admin.ok("POST", `/v1/platform/staff/${ownerId}/password`, { password: "brand-new-pass" });
    const fresh = new Client(app);
    expect((await fresh.req("POST", "/v1/auth/login", { email: "owner@plat-one.test", password: "ownerpass123" })).statusCode).toBe(401);
    await fresh.ok("POST", "/v1/auth/login", { email: "owner@plat-one.test", password: "brand-new-pass" });

    await admin.ok("PATCH", `/v1/platform/hotels/${hotelId}`, { phone: "98765 43210", gstin: "21ABCDE1234F1Z5" });
    expect((await admin.req("PATCH", `/v1/platform/hotels/${hotelId}`, { gstin: "nope" })).statusCode).toBe(400);
    await admin.ok("PATCH", `/v1/platform/hotels/${hotelId}`, { status: "SUSPENDED" });
    expect((await fresh.req("GET", "/v1/admin/staff")).json().error.code).toBe("HOTEL_SUSPENDED");

    await admin.ok("DELETE", `/v1/platform/hotels/${hotelId}`);
    expect(await unscopedDb.hotel.findUnique({ where: { id: hotelId } })).toBeNull();
    expect((await admin.req("DELETE", `/v1/platform/hotels/${hotelId}`)).statusCode).toBe(404);
  });

  it("owners can't reach platform routes", async () => {
    const { owner: other } = await createHotel(app, admin, "plat-two");
    expect((await other.req("GET", "/v1/platform/sessions")).statusCode).toBe(403);
  });
});
