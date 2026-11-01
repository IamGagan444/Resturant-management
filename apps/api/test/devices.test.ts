import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { closeQueue } from "../src/jobs/queue";
import { Client, createHotel, createPlatformAdmin, getApp, resetDb } from "./helpers";

interface DeviceInfo {
  device: { kind: string };
  staff: { id: string; name: string; role: string }[];
}

/** Shared devices: pairing codes, who may sign in where, and longer PINs for owners and managers. */
describe("device security", () => {
  let app: FastifyInstance;
  let owner: Client;
  let ownerId: string;
  let waiterId: string;
  let cookId: string;
  let managerId: string;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    const admin = await createPlatformAdmin(app);
    ({ owner } = await createHotel(app, admin, "dev-sec"));
    ownerId = (await owner.ok<{ id: string; role: string }[]>("GET", "/v1/admin/staff")).find((s) => s.role === "OWNER")!.id;
    waiterId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Waiter", role: "WAITER", pin: "4001" })).id;
    cookId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Cook", role: "COOK", pin: "3001" })).id;
    managerId = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Manager", role: "MANAGER", pin: "123456" })).id;
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  /** A fresh browser that typed a pairing code made by the owner. */
  async function pairedByCode(kind: "WAITER" | "KDS" | "MANAGER") {
    const { code } = await owner.ok<{ code: string }>("POST", "/v1/admin/devices/pair-code", { name: `${kind} phone`, kind });
    const device = new Client(app);
    await device.ok("POST", "/v1/auth/devices/claim", { code });
    return { device, code };
  }

  it("a pairing code pairs a new device once, without anyone signing in on it", async () => {
    const { device, code } = await pairedByCode("WAITER");
    expect(device.cookies.has("rms_at")).toBe(false); // nobody is signed in: only the device cookie
    const info = await device.ok<DeviceInfo>("GET", "/v1/auth/device");
    expect(info.device.kind).toBe("WAITER");

    const again = await new Client(app).req("POST", "/v1/auth/devices/claim", { code });
    expect(again.statusCode).toBe(400);
    expect(again.json().error.code).toBe("BAD_PAIR_CODE");
    expect((await new Client(app).req("POST", "/v1/auth/devices/claim", { code: "12" })).statusCode).toBe(400);
  });

  it("only owners and managers can make pairing codes", async () => {
    const { device } = await pairedByCode("WAITER");
    await device.ok("POST", "/v1/auth/pin", { staffId: waiterId, pin: "4001" });
    const r = await device.req("POST", "/v1/admin/devices/pair-code", { name: "Sneaky", kind: "WAITER" });
    expect(r.statusCode).toBe(403);
  });

  it("the owner is not offered on staff devices and can't PIN in there; a Manager device allows them", async () => {
    const { device: waiterPhone } = await pairedByCode("WAITER");
    const info = await waiterPhone.ok<DeviceInfo>("GET", "/v1/auth/device");
    expect(info.staff.map((s) => s.role).sort()).toEqual(["MANAGER", "WAITER"]);
    expect((await waiterPhone.req("POST", "/v1/auth/pin", { staffId: ownerId, pin: "999999" })).statusCode).toBe(403);
    // a cook doesn't belong on a waiter phone either, even with the right PIN
    expect((await waiterPhone.req("POST", "/v1/auth/pin", { staffId: cookId, pin: "3001" })).statusCode).toBe(403);
    await waiterPhone.ok("POST", "/v1/auth/pin", { staffId: managerId, pin: "123456" });

    const { device: managerTablet } = await pairedByCode("MANAGER");
    await managerTablet.ok("POST", "/v1/auth/pin", { staffId: ownerId, pin: "999999" });
  });

  it("owners and managers need a 6-digit PIN", async () => {
    const short = await owner.req("POST", "/v1/admin/staff", { name: "M2", role: "MANAGER", pin: "1234" });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.details.fieldErrors.pin?.[0]).toMatch(/6-digit/);
    expect((await owner.req("POST", `/v1/admin/staff/${managerId}/reset-pin`, { pin: "4321" })).statusCode).toBe(400);
    await owner.ok("POST", `/v1/admin/staff/${waiterId}/reset-pin`, { pin: "4321" }); // staff keep 4 digits

    // promoted with an old 4-digit PIN: told to set a longer one, and it doesn't count as a wrong guess
    const promoted = (await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: "Soon manager", role: "WAITER", pin: "5555" })).id;
    await owner.ok("PATCH", `/v1/admin/staff/${promoted}`, { role: "MANAGER" });
    const { device } = await pairedByCode("WAITER");
    const r = await device.req("POST", "/v1/auth/pin", { staffId: promoted, pin: "5555" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("PIN_TOO_SHORT");
  });
});
