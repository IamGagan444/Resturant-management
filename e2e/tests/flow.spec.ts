import path from "node:path";
import { config } from "dotenv";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E } from "../ports";

config({ path: path.resolve(import.meta.dirname, "../../.env") });

const CUSTOMER = E2E.customer;
const CONSOLE = E2E.console;
const OWNER = { email: "owner@spicegarden.test", password: "owner12345" };

/** Owner pairs a fresh browser as a device, then the staff member signs in with their PIN. */
async function staffDevice(browser: Browser, kind: "Kitchen screen" | "Waiter phone" | "Counter", who: string, pin: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(`${CONSOLE}/login/`);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("tab", { name: "Devices" }).click();
  await page.getByLabel("Name").fill(`${kind} (e2e)`);
  await page.getByRole("combobox", { name: /Used as/ }).click();
  await page.getByRole("option", { name: kind }).click();
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(page.getByText("Who's working?")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(who) }).click();
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Enter" }).click();
  return page;
}

async function qrToken(label: string): Promise<string> {
  const { unscopedDb } = await import("@rms/db");
  const t = await unscopedDb.table.findFirstOrThrow({ where: { label, hotel: { slug: "spice-garden" } } });
  await unscopedDb.$disconnect();
  return t.qrToken;
}

test("scan → order → cook → serve → pay", async ({ browser }) => {
  const qr = await qrToken("T1");

  // Staff devices
  const kitchen = await staffDevice(browser, "Kitchen screen", "Raju", "3001");
  await expect(kitchen.getByRole("heading", { name: /Kitchen/ })).toBeVisible();
  const waiter = await staffDevice(browser, "Waiter phone", "Ravi", "4001", { width: 400, height: 860 });
  await expect(waiter.getByRole("heading", { name: "Floor" })).toBeVisible();

  // Customer scans T1 on a phone
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await phoneCtx.newPage();
  await phone.goto(`${CUSTOMER}/h/spice-garden/t/${qr}`);
  await phone.getByLabel("Your name").fill("Rahul");
  await phone.getByRole("button", { name: "Start ordering" }).click();
  await expect(phone.getByText(/Table T1/)).toBeVisible();

  // Add 2 × Butter Naan to the shared cart and place the order
  await phone.getByLabel("Search dishes").fill("Butter Naan");
  await phone.getByRole("listitem").filter({ has: phone.getByRole("heading", { name: "Butter Naan" }) }).getByRole("button", { name: "ADD" }).click();
  await phone.getByRole("button", { name: "Increase quantity" }).click();
  await phone.getByRole("button", { name: /Add · ₹120/ }).click();
  await phone.getByRole("button", { name: /View cart/ }).click();
  await phone.getByRole("button", { name: "Order now, pay later" }).click();
  await expect(phone.getByText("Order #1")).toBeVisible();

  // Kitchen: ticket appears live; start then ready
  const naan = kitchen.getByRole("button", { name: /Butter Naan: tap to start/ });
  await expect(naan).toBeVisible();
  await naan.click();
  await kitchen.getByRole("button", { name: /Butter Naan: tap when ready/ }).click();
  await expect(kitchen.getByText("No open tickets")).toBeVisible();

  // Customer sees it ready
  await expect(phone.getByRole("list", { name: "Ready", exact: true })).toBeVisible();

  // Waiter: picked up → served
  await waiter.getByRole("button", { name: "Picked up" }).click();
  await waiter.getByRole("button", { name: "Served" }).click();
  await expect(phone.getByText("Served", { exact: true }).first()).toBeVisible();

  // Customer requests the bill and pays by (mock) UPI: ₹120 + 5% GST = ₹126
  await phone.getByRole("button", { name: "🧾 Bill" }).click();
  await expect(phone.getByText("CGST 2.5%")).toBeVisible();
  await phone.getByRole("button", { name: "Pay ₹126 by UPI" }).click();
  await expect(phone.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  await expect(phone.getByRole("link", { name: "View your bill" })).toBeVisible();

  // Table goes to cleaning; waiter frees it in one tap
  const ready = waiter.getByRole("button", { name: "Ready ✓" });
  await expect(ready).toBeVisible();
  await ready.click();
  await expect(ready).toHaveCount(0);
});

test("two dishes: one served while the other is still waiting stays in sync on every screen", async ({ browser }) => {
  const qr = await qrToken("T4");
  const kitchen = await staffDevice(browser, "Kitchen screen", "Raju", "3001"); // tandoor: the naan
  const mains = await staffDevice(browser, "Kitchen screen", "Suresh", "3002"); // kitchen station: the dal
  const waiter = await staffDevice(browser, "Waiter phone", "Ravi", "4001", { width: 400, height: 860 });
  // the same waiter's second phone (or a colleague covering the table): it must follow without being touched
  const waiter2 = await staffDevice(browser, "Waiter phone", "Ravi", "4001", { width: 400, height: 860 });

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  await phone.goto(`${CUSTOMER}/h/spice-garden/t/${qr}`);
  await phone.getByLabel("Your name").fill("Meera");
  await phone.getByRole("button", { name: "Start ordering" }).click();
  for (const dish of ["Butter Naan", "Dal Makhani"]) {
    await phone.getByLabel("Search dishes").fill(dish);
    await phone.getByRole("listitem").filter({ has: phone.getByRole("heading", { name: dish }) }).getByRole("button", { name: "ADD" }).click();
    await phone.getByRole("button", { name: /Add · ₹/ }).click();
    await expect(phone.getByRole("button", { name: /Add · ₹/ })).toBeHidden();
  }
  await phone.getByRole("button", { name: /View cart/ }).click();
  await phone.getByRole("button", { name: "Order now, pay later" }).click();

  // the tandoor finishes the naan; the dal hasn't been started
  await kitchen.getByRole("button", { name: /Butter Naan: tap to start/ }).click();
  await kitchen.getByRole("button", { name: /Butter Naan: tap when ready/ }).click();
  await expect(mains.getByRole("button", { name: /Dal Makhani: tap to start/ })).toBeVisible();

  // one waiter takes the naan to the table
  const naanOn = (p: typeof waiter) => p.locator("div").filter({ hasText: /^T4.*Butter Naan/ });
  await expect(waiter2.getByRole("button", { name: "Picked up" })).toBeVisible();
  await waiter.getByRole("button", { name: "Picked up" }).click();
  await waiter.getByRole("button", { name: "Served" }).click();

  // guest: naan served, dal still just received
  await expect(phone.getByRole("list", { name: "Served", exact: true })).toBeVisible();
  await expect(phone.getByRole("list", { name: "Received", exact: true })).toBeVisible();
  // the other waiter's phone dropped the naan by itself; the kitchen still has the dal to cook
  await expect(waiter2.getByRole("button", { name: "Picked up" })).toBeHidden();
  await expect(naanOn(waiter2)).toHaveCount(0);
  await expect(mains.getByRole("button", { name: /Dal Makhani: tap to start/ })).toBeVisible();
  await expect(kitchen.getByText("No open tickets")).toBeVisible();
});

test("pay now → order goes to the kitchen → leave → digital bill (in Hindi)", async ({ browser }) => {
  const qr = await qrToken("T2");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await ctx.newPage();
  await phone.goto(`${CUSTOMER}/h/spice-garden/t/${qr}`);
  await phone.getByLabel("Language").selectOption("hi");
  await phone.getByLabel("आपका नाम").fill("Asha");
  await phone.getByRole("button", { name: "ऑर्डर शुरू करें" }).click();
  await expect(phone.getByText(/टेबल T2/)).toBeVisible();

  await phone.getByLabel("डिश खोजें").fill("Butter Naan");
  await phone.getByRole("listitem").filter({ has: phone.getByRole("heading", { name: /बटर नान|Butter Naan/ }) }).getByRole("button", { name: "जोड़ें" }).click();
  await phone.getByRole("button", { name: /जोड़ें · ₹60/ }).click();
  await phone.getByRole("button", { name: /कार्ट देखें/ }).click();
  await phone.getByRole("button", { name: /अभी UPI से भुगतान करें · ₹60/ }).click();

  // paid → released to the kitchen (tracker visible, no "waiting for payment")
  await expect(phone.getByRole("list", { name: "मिल गया", exact: true })).toBeVisible();
  await expect(phone.getByText(/भुगतान बाकी है/)).toHaveCount(0);

  // everything is prepaid: leaving closes the table straight away
  await phone.getByRole("button", { name: "🧾 बिल" }).click();
  await phone.getByRole("button", { name: "हो गया, टेबल छोड़ रहे हैं" }).click();
  await expect(phone.getByRole("heading", { name: "धन्यवाद!" })).toBeVisible();

  await phone.getByRole("link", { name: "अपना बिल देखें" }).click();
  await expect(phone.getByText("Tax invoice")).toBeVisible();
  await expect(phone.getByText(/INV\/\d{4}\/\d{5}/)).toBeVisible();
});

test("kitchen keeps working offline and syncs when the connection is back", async ({ browser, playwright }) => {
  // a guest at T3 orders through the API
  const guest = await playwright.request.newContext({ baseURL: E2E.api });
  await guest.post("/v1/p/sessions/join", { data: { qrToken: await qrToken("T3"), deviceId: "e2e-offline-guest", name: "Om" } });
  const naan = await guest.get("/v1/p/h/spice-garden/menu").then(async (r) => ((await r.json()) as { items: { id: string; name: string }[] }).items.find((i) => i.name === "Butter Naan")!);
  await guest.put("/v1/p/cart/items/e2e-offline-line-1", { data: { itemId: naan.id, quantity: 1 } });
  const order = (await (await guest.post("/v1/p/orders", { data: { clientId: crypto.randomUUID(), payment: "PAY_LATER" } })).json()) as { items: { id: string }[] };

  const kitchen = await staffDevice(browser, "Kitchen screen", "Raju", "3001");
  const ticket = kitchen.locator("article", { hasText: "T3" });
  await expect(ticket).toBeVisible();

  // internet drops: the tap still works on screen and waits on the device
  await kitchen.context().setOffline(true);
  await ticket.getByRole("button", { name: /Butter Naan: tap to start/ }).click();
  await expect(ticket.getByRole("button", { name: /Butter Naan: tap when ready/ })).toBeVisible();
  await expect(kitchen.getByRole("status").filter({ hasText: /Offline/ })).toContainText("1 action waiting");

  const status = async () => {
    const { unscopedDb } = await import("@rms/db");
    return (await unscopedDb.orderItem.findUniqueOrThrow({ where: { id: order.items[0]!.id } })).status;
  };
  expect(await status()).toBe("QUEUED");

  // back online: the queued tap reaches the server by itself
  await kitchen.context().setOffline(false);
  await expect.poll(status, { timeout: 30_000 }).toBe("COOKING");
  await expect(kitchen.getByRole("status").filter({ hasText: /Offline/ })).toHaveCount(0);
});
