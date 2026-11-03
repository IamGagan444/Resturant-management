import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { unscopedDb } from "@rms/db";
import { closeQueue } from "../src/jobs/queue";
import { hmacSha256Hex } from "../src/lib/crypto";
import { redactUrl } from "../src/lib/security";
import { sniffImage } from "../src/lib/storage";
import { base32Encode, currentStep, hotp, verifyTotp } from "../src/lib/totp";
import { MOCK_SECRET } from "../src/payments/gateway";
import { Client, authenticators, createHotel, createPlatformAdmin, getApp, resetDb, signIn } from "./helpers";

const CONSOLE = "http://localhost:3001";
const EVIL = "https://evil.example";

describe("security controls", () => {
  let app: FastifyInstance;
  let admin: Client;
  let owner: Client; // reassigned when the owner re-enrols after an MFA reset
  let hotelId: string;

  beforeAll(async () => {
    await resetDb();
    app = await getApp();
    admin = await createPlatformAdmin(app);
    ({ owner, hotelId } = await createHotel(app, admin, "sec-hotel"));
  });

  afterAll(async () => {
    await app.close();
    await closeQueue();
  });

  /** A manager with a password, signed in on the web. */
  async function manager(email: string, password = "managerpass1") {
    const { id } = await owner.ok<{ id: string }>("POST", "/v1/admin/staff", { name: email, role: "MANAGER", pin: "246810", email, password });
    const c = new Client(app);
    await signIn(c, email, password);
    return { id, c };
  }

  // ── CSRF / headers ─────────────────────────
  it("refuses cookie-authenticated writes from a foreign origin, allows our own and non-browser clients", async () => {
    const evil = await owner.req("POST", "/v1/admin/floors", { name: "Evil floor" }, { origin: EVIL });
    expect(evil.statusCode).toBe(403);
    const evilReferer = await owner.req("POST", "/v1/admin/floors", { name: "Evil floor" }, { referer: `${EVIL}/x` });
    expect(evilReferer.statusCode).toBe(403);
    expect((await owner.req("POST", "/v1/admin/floors", { name: "Ours" }, { origin: CONSOLE })).statusCode).toBe(201);
    expect((await owner.req("POST", "/v1/admin/floors", { name: "Script" })).statusCode).toBe(201); // no Origin: not a browser
    // reads are never blocked
    expect((await owner.req("GET", "/v1/admin/floors", undefined, { origin: EVIL })).statusCode).toBe(200);
  });

  it("sends security headers", async () => {
    const r = await owner.req("GET", "/v1/auth/me");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(String(r.headers["content-security-policy"])).toContain("frame-ancestors 'none'");
  });

  // ── Login brute force ──────────────────────
  it("locks an account after 10 wrong passwords, even when the right one comes next", async () => {
    await manager("lock@sec.test", "rightpass99");
    for (let i = 0; i < 10; i++) {
      const r = await new Client(app).req("POST", "/v1/auth/login", { email: "lock@sec.test", password: `wrong-${i}` });
      expect(r.statusCode).toBe(401);
    }
    const locked = await new Client(app).req("POST", "/v1/auth/login", { email: "lock@sec.test", password: "rightpass99" });
    expect(locked.statusCode).toBe(429);
    // unknown emails get the same answer as wrong passwords
    const unknown = await new Client(app).req("POST", "/v1/auth/login", { email: "nobody@sec.test", password: "whatever1" });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe("Wrong email or password");
  });

  // ── MFA (required) ─────────────────────
  it("a password alone never opens a session: first sign-in enrolls an authenticator", async () => {
    await owner.ok("POST", "/v1/admin/staff", { name: "New", role: "MANAGER", pin: "246813", email: "new@sec.test", password: "newpass1234" });
    const browser = new Client(app);
    const r = await browser.ok<{ mfaSetupRequired?: boolean; mfaToken: string }>("POST", "/v1/auth/login", { email: "new@sec.test", password: "newpass1234" });
    expect(r.mfaSetupRequired).toBe(true);
    expect(browser.cookies.has("rms_at")).toBe(false);
    // the pending token is not an access token, and an enroll token can't skip to the code step
    expect((await new Client(app).req("GET", "/v1/auth/me", undefined, { authorization: `Bearer ${r.mfaToken}` })).statusCode).toBe(401);
    expect((await browser.req("POST", "/v1/auth/login/mfa", { mfaToken: r.mfaToken, code: "123456" })).statusCode).toBe(401);

    const { secret, qrDataUrl } = await browser.ok<{ secret: string; qrDataUrl: string }>("POST", "/v1/auth/mfa/enroll/start", { mfaToken: r.mfaToken });
    expect(qrDataUrl).toMatch(/^data:image\/png;base64,/);
    const wrong = hotp(secret, currentStep()) === "000000" ? "111111" : "000000";
    expect((await browser.req("POST", "/v1/auth/mfa/enroll/finish", { mfaToken: r.mfaToken, code: wrong })).statusCode).toBe(400);
    const done = await browser.ok<{ recoveryCodes: string[] }>("POST", "/v1/auth/mfa/enroll/finish", { mfaToken: r.mfaToken, code: hotp(secret, currentStep()) });
    expect(done.recoveryCodes).toHaveLength(10);
    expect(browser.cookies.has("rms_at")).toBe(true);
    expect((await browser.ok<{ enabled: boolean; required: boolean }>("GET", "/v1/auth/mfa"))).toMatchObject({ enabled: true, required: true });
    // the same enroll token can't be used again
    expect((await new Client(app).req("POST", "/v1/auth/mfa/enroll/finish", { mfaToken: r.mfaToken, code: hotp(secret, currentStep() + 1) })).statusCode).toBe(409);
  });

  it("second step: codes can't be replayed, pending tokens are single use, recovery codes work once", async () => {
    await manager("mfa@sec.test", "mfapass1234"); // enrolled
    const { secret, recovery } = authenticators.get("mfa@sec.test")!;
    const step1 = await new Client(app).ok<{ mfaRequired?: boolean; mfaToken: string }>("POST", "/v1/auth/login", { email: "mfa@sec.test", password: "mfapass1234" });
    expect(step1.mfaRequired).toBe(true);
    const browser = new Client(app);
    expect((await browser.req("POST", "/v1/auth/login/mfa", { mfaToken: step1.mfaToken, code: "12345a" })).statusCode).toBe(401);
    const next = hotp(secret, currentStep() + 1); // the enrolment code's step is used up
    await browser.ok("POST", "/v1/auth/login/mfa", { mfaToken: step1.mfaToken, code: next });
    expect(browser.cookies.has("rms_at")).toBe(true);
    // same code again: refused; same pending token with another valid factor: refused (single use)
    expect((await new Client(app).req("POST", "/v1/auth/login/mfa", { mfaToken: step1.mfaToken, code: next })).statusCode).toBe(401);
    expect((await new Client(app).req("POST", "/v1/auth/login/mfa", { mfaToken: step1.mfaToken, code: recovery[0] })).statusCode).toBe(401);

    const t2 = await new Client(app).ok<{ mfaToken: string }>("POST", "/v1/auth/login", { email: "mfa@sec.test", password: "mfapass1234" });
    const code = recovery[1]!;
    await new Client(app).ok("POST", "/v1/auth/login/mfa", { mfaToken: t2.mfaToken, code: code.toUpperCase() });
    const t3 = await new Client(app).ok<{ mfaToken: string }>("POST", "/v1/auth/login", { email: "mfa@sec.test", password: "mfapass1234" });
    expect((await new Client(app).req("POST", "/v1/auth/login/mfa", { mfaToken: t3.mfaToken, code })).statusCode).toBe(401);

    // can't be turned off while required; moving to a new phone needs password + current factor
    expect((await browser.req("POST", "/v1/auth/mfa/disable", { password: "mfapass1234", code: recovery[2] })).statusCode).toBe(409);
    expect((await browser.req("POST", "/v1/auth/mfa/setup", { password: "mfapass1234" })).statusCode).toBe(401);
    const moved = await browser.ok<{ secret: string }>("POST", "/v1/auth/mfa/setup", { password: "mfapass1234", code: recovery[3] });
    await browser.ok("POST", "/v1/auth/mfa/enable", { code: hotp(moved.secret, currentStep()) });
    // the old phone no longer works
    const t4 = await new Client(app).ok<{ mfaToken: string }>("POST", "/v1/auth/login", { email: "mfa@sec.test", password: "mfapass1234" });
    expect((await new Client(app).req("POST", "/v1/auth/login/mfa", { mfaToken: t4.mfaToken, code: hotp(secret, currentStep() + 1) })).statusCode).toBe(401);
    expect((await browser.req("GET", "/v1/auth/mfa")).statusCode).toBe(200); // the browser that moved it stays signed in
  });

  it("platform admins are held to two-step sign-in too, and can reset an owner's lost authenticator", async () => {
    const r = await new Client(app).ok<{ mfaRequired?: boolean; typ: string }>("POST", "/v1/auth/login", { email: "root@test.dev", password: "rootpass123" });
    expect(r).toMatchObject({ mfaRequired: true, typ: "platform" });
    const { id } = await manager("lost@sec.test");
    const ownerRow = await unscopedDb.staff.findFirstOrThrow({ where: { hotelId, role: "OWNER" } });
    await admin.ok("POST", `/v1/platform/staff/${ownerRow.id}/mfa-reset`);
    const again = await new Client(app).ok<{ mfaSetupRequired?: boolean }>("POST", "/v1/auth/login", { email: "owner@sec-hotel.test", password: "ownerpass123" });
    expect(again.mfaSetupRequired).toBe(true);
    expect((await owner.req("GET", "/v1/admin/floors")).statusCode).toBe(401); // reset signs them out
    authenticators.delete("owner@sec-hotel.test");
    owner = new Client(app);
    await signIn(owner, "owner@sec-hotel.test", "ownerpass123"); // enrolls a new one
    // the owner resets a manager's; a manager can't
    const m = await manager("resetter@sec.test");
    expect((await m.c.req("POST", `/v1/admin/staff/${id}/mfa-reset`)).statusCode).toBe(403);
    await owner.ok("POST", `/v1/admin/staff/${id}/mfa-reset`);
  });

  it("5 wrong second-step codes lock the second step", async () => {
    await manager("mfa2@sec.test", "mfapass5678");
    const { secret } = authenticators.get("mfa2@sec.test")!;
    const { mfaToken } = await new Client(app).ok<{ mfaToken: string }>("POST", "/v1/auth/login", { email: "mfa2@sec.test", password: "mfapass5678" });
    const bad = (st: number) => String((Number(hotp(secret, st)) + 1) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 5; i++) expect((await new Client(app).req("POST", "/v1/auth/login/mfa", { mfaToken, code: bad(currentStep()) })).statusCode).toBe(401);
    const locked = await new Client(app).req("POST", "/v1/auth/login/mfa", { mfaToken, code: hotp(secret, currentStep() + 1) });
    expect(locked.statusCode).toBe(429);
  });

  // ── Logout / single-session sign-out ─────
  it("logout ends that browser's access token at once — also older ones from before a refresh — and nobody else's", async () => {
    const { c } = await manager("bye@sec.test");
    const other = new Client(app);
    await signIn(other, "bye@sec.test", "managerpass1");
    const stolen = c.cookies.get("rms_at")!; // copied before the refresh below
    await c.ok("POST", "/v1/auth/refresh");
    expect(c.cookies.get("rms_at")).not.toBe(stolen);
    await c.ok("POST", "/v1/auth/logout");
    const bearer = (t: string) => new Client(app).req("GET", "/v1/auth/me", undefined, { authorization: `Bearer ${t}` });
    expect((await bearer(stolen)).statusCode).toBe(401);
    expect((await c.req("POST", "/v1/auth/refresh")).statusCode).toBe(401);
    expect((await other.req("GET", "/v1/admin/floors")).statusCode).toBe(200); // the other browser is untouched
  });

  it("platform 'sign out this session' ends exactly that browser", async () => {
    const { id, c } = await manager("one@sec.test");
    const second = new Client(app);
    await signIn(second, "one@sec.test", "managerpass1");
    const sessions = await admin.ok<{ id: string; person: { id: string }; lastActiveAt: string }[]>("GET", `/v1/platform/sessions?hotelId=${hotelId}`);
    const mine = sessions.filter((x) => x.person.id === id).sort((a, b) => a.lastActiveAt.localeCompare(b.lastActiveAt));
    expect(mine).toHaveLength(2);
    await admin.ok("DELETE", `/v1/platform/sessions/${mine[0]!.id}`); // the first browser
    expect((await c.req("GET", "/v1/admin/floors")).statusCode).toBe(401);
    expect((await second.req("GET", "/v1/admin/floors")).statusCode).toBe(200);
  });

  // ── Session revocation ─────────────────────
  it("deactivating someone ends their live access token at once", async () => {
    const { id, c } = await manager("gone@sec.test");
    expect((await c.req("GET", "/v1/admin/floors")).statusCode).toBe(200);
    await owner.ok("PATCH", `/v1/admin/staff/${id}`, { isActive: false });
    expect((await c.req("GET", "/v1/admin/floors")).statusCode).toBe(401);
  });

  // ── Privilege boundaries ───────────────────
  it("only the owner can change UPI keys (audited); managers can't take over other managers", async () => {
    const m1 = await manager("m1@sec.test");
    const m2 = await manager("m2@sec.test");
    const keys = { razorpay: { keyId: "rzp_test_abc", keySecret: "secret123456", webhookSecret: "whsec123456" } };
    const denied = await m1.c.req("PATCH", "/v1/admin/hotel", keys);
    expect(denied.statusCode).toBe(403);
    await owner.ok("PATCH", "/v1/admin/hotel", keys);
    const log = await owner.ok<{ entries: { action: string }[] }>("GET", "/v1/admin/audit?action=PAYMENT_KEYS_CHANGED");
    expect(log.entries).toHaveLength(1);
    // the secret never comes back
    const h = await owner.ok<Record<string, unknown>>("GET", "/v1/admin/hotel");
    expect(JSON.stringify(h)).not.toContain("secret123456");
    await owner.ok("PATCH", "/v1/admin/hotel", { razorpay: undefined }); // other settings still work for everyone
    await m1.c.ok("PATCH", "/v1/admin/hotel", { allowPayLater: true });

    expect((await m1.c.req("PATCH", `/v1/admin/staff/${m2.id}`, { password: "takeover123" })).statusCode).toBe(403);
    expect((await m1.c.req("PATCH", `/v1/admin/staff/${m2.id}`, { email: "mine@sec.test" })).statusCode).toBe(403);
    expect((await m1.c.req("POST", `/v1/admin/staff/${m2.id}/reset-pin`, { pin: "135790" })).statusCode).toBe(403);
    // the owner can, and that signs the manager out everywhere
    await owner.ok("PATCH", `/v1/admin/staff/${m2.id}`, { password: "newpass12345" });
    expect((await m2.c.req("GET", "/v1/admin/floors")).statusCode).toBe(401);
  });

  // ── Input validation ───────────────────────
  it("rejects non-http image URLs and hub URLs", async () => {
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Starters" });
    const item = { categoryId: cat.id, name: "Paneer", price: 10000, foodType: "VEG", imageUrl: "javascript:alert(1)" };
    const bad = await owner.req("POST", "/v1/admin/items", item);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.fieldErrors.imageUrl).toBeDefined();
    expect((await owner.req("POST", "/v1/admin/items", { ...item, imageUrl: "https://cdn.example/p.webp" })).statusCode).toBe(201);
    const hub = await owner.req("POST", "/v1/admin/hub", { name: "Hub", url: "javascript:alert(1)" });
    expect(hub.statusCode).toBe(400);
    expect(hub.json().error.details.fieldErrors.url).toBeDefined();
  });

  it("a partial update never resets fields the client didn't send (create-time defaults don't leak into PATCH)", async () => {
    const cat = await owner.ok<{ id: string }>("POST", "/v1/admin/categories", { name: "Mains" });
    const tax = await owner.ok<{ id: string }>("POST", "/v1/admin/taxes", { name: "VAT", rateBps: 500 });
    const item = await owner.ok<{ id: string }>("POST", "/v1/admin/items", {
      categoryId: cat.id,
      name: "Thali",
      price: 25000,
      foodType: "NON_VEG",
      isAvailable: false,
      isBestseller: true,
      prepTimeMin: 40,
      taxIds: [tax.id],
      variants: [{ name: "Half", price: 15000 }],
    });
    const after = await owner.ok<Record<string, unknown>>("PATCH", `/v1/admin/items/${item.id}`, { price: 26000 });
    expect(after).toMatchObject({ price: 26000, foodType: "NON_VEG", isAvailable: false, isBestseller: true, prepTimeMin: 40, taxIds: [tax.id] });
    expect(after.variants).toHaveLength(1);
    const t = await owner.ok<{ id: string }>("POST", "/v1/admin/tables", { label: "P1", seats: 8, isRoom: true });
    expect(await owner.ok("PATCH", `/v1/admin/tables/${t.id}`, { label: "P2" })).toMatchObject({ label: "P2", seats: 8, isRoom: true });
  });

  it("uploads: a non-image with an image MIME type is refused", async () => {
    const boundary = "----x";
    const payload = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n<?php system($_GET['c']); ?>\r\n--${boundary}--\r\n`;
    const r = await app.inject({
      method: "POST",
      url: "/v1/admin/uploads",
      payload,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, cookie: `rms_at=${owner.cookies.get("rms_at")}` },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("BAD_IMAGE");
  });

  // ── Table join code brute force ────────────
  it("caps wrong join codes per table session", async () => {
    const { qrToken } = await owner.ok<{ qrToken: string }>("POST", "/v1/admin/tables", { label: "S1" });
    const host = await new Client(app).ok<{ session: { joinCode: string } }>("POST", "/v1/p/sessions/join", { qrToken, deviceId: "host-device-01", name: "Host" });
    const code = host.session.joinCode;
    let n = 0;
    for (let guess = 0; n < 20; guess++) {
      const g = String(guess).padStart(4, "0");
      if (g === code) continue;
      n++;
      const r = await new Client(app).req("POST", "/v1/p/sessions/join", { qrToken, deviceId: `atk-device-${guess}`, name: "x", joinCode: g });
      expect(r.statusCode).toBe(403);
    }
    const blocked = await new Client(app).req("POST", "/v1/p/sessions/join", { qrToken, deviceId: "atk-device-final", name: "x", joinCode: code });
    expect(blocked.statusCode).toBe(429);
  });

  // ── Webhooks ───────────────────────────────
  it("webhooks: bad signature refused, processed events not replayed, amount mismatch never settles", async () => {
    const url = `/v1/webhooks/razorpay/${hotelId}`;
    const send = (body: string, sig: string, eventId: string) =>
      app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": eventId } });

    const event = (orderId: string, amount: number) =>
      JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: orderId, amount, status: "captured" } } } });
    const body = event("order_unknown", 100);
    expect((await send(body, "deadbeef", "evt_1")).statusCode).toBe(400);
    const sig = hmacSha256Hex(MOCK_SECRET, body);
    expect((await send(body, sig, "evt_1")).json()).toEqual({ ok: true });
    expect((await send(body, sig, "evt_1")).json()).toEqual({ ok: true, duplicate: true });
    const bad = "{not json";
    expect((await send(bad, hmacSha256Hex(MOCK_SECRET, bad), "evt_2")).statusCode).toBe(400);

    // a captured event whose amount differs from what we asked for marks the attempt failed
    const { qrToken } = await owner.ok<{ qrToken: string }>("POST", "/v1/admin/tables", { label: "W1" });
    const joined = await new Client(app).ok<{ session: { id: string } }>("POST", "/v1/p/sessions/join", { qrToken, deviceId: "webhook-dev-1", name: "Payer" });
    const p = await unscopedDb.payment.create({
      data: { hotelId, sessionId: joined.session.id, clientId: "client-webhook-1", method: "UPI", amount: 50000, gatewayOrderId: "order_w1" },
    });
    const cheap = event("order_w1", 100);
    await send(cheap, hmacSha256Hex(MOCK_SECRET, cheap), "evt_3");
    const after = await unscopedDb.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ status: "FAILED", gatewayRef: "AMOUNT_MISMATCH" });
  });
});

describe("security helpers", () => {
  it("TOTP matches RFC 6238 (SHA-1 test vectors)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    // RFC 6238 Appendix B, truncated to 6 digits
    expect(hotp(secret, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(hotp(secret, Math.floor(1234567890 / 30))).toBe("005924");
    expect(verifyTotp(secret, "081804", 1111111109 * 1000)).toBe(Math.floor(1111111109 / 30));
    expect(verifyTotp(secret, "081804", (1111111109 + 3600) * 1000)).toBeNull();
    expect(verifyTotp(secret, "abc", Date.now())).toBeNull();
  });

  it("redacts capability tokens from logged URLs", () => {
    expect(redactUrl("/v1/r/abc.def")).toBe("/v1/r/[redacted]");
    expect(redactUrl("/v1/p/t/qr123?deviceId=xyz")).toBe("/v1/p/t/[redacted]?deviceId=[redacted]");
    expect(redactUrl("/v1/admin/hotel")).toBe("/v1/admin/hotel");
  });

  it("sniffs real image signatures only", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImage(Buffer.from("RIFF0000WEBPVP8 "))).toBe("webp");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});
