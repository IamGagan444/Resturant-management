import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E } from "../ports";
import { signedInContext } from "../totp";

const CONSOLE = E2E.console;
const CUSTOMER = E2E.customer;
const OWNER = { email: "owner@spicegarden.test", password: "owner12345" };

/** Pair a device by code and sign `who` in with their PIN (same steps a restaurant follows). */
async function staffDevice(browser: Browser, kind: "Kitchen screen" | "Waiter phone" | "Counter", who: string, pin: string): Promise<Page> {
  const ownerCtx = await signedInContext(browser, CONSOLE, OWNER.email, OWNER.password, "/manage");
  const owner = await ownerCtx.newPage();
  await owner.goto(`${CONSOLE}/manage/`);
  await owner.getByRole("tab", { name: "Devices" }).click();
  await owner.getByRole("textbox", { name: /Device name/ }).fill(`${kind} (features e2e)`);
  await owner.getByRole("combobox", { name: /Used as/ }).click();
  await owner.getByRole("option", { name: kind }).click();
  await owner.getByRole("button", { name: "Get a pairing code" }).click();
  const code = (await owner.getByTestId("pair-code").textContent())?.trim() ?? "";
  await ownerCtx.close();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${CONSOLE}/device/`);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair this device" }).click();
  await page.getByRole("button", { name: new RegExp(who) }).click();
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
  return page;
}

test("attendance: a PIN sign-in shows the person on duty; a manager marks leave", async ({ browser }) => {
  const waiter = await staffDevice(browser, "Waiter phone", "Priya", "4002");
  await expect(waiter.getByRole("heading", { name: "Floor" })).toBeVisible();

  const ownerCtx = await signedInContext(browser, CONSOLE, OWNER.email, OWNER.password, "/manage");
  const owner = await ownerCtx.newPage();
  await owner.goto(`${CONSOLE}/manage/#attendance`);
  await expect(owner.getByRole("heading", { name: "Today" })).toBeVisible();
  // rows of the attendance list (the toast region is a list too, so scope to the page body)
  const rows = owner.getByRole("main").getByRole("listitem");
  const priya = rows.filter({ hasText: "Priya" });
  await expect(priya.getByText("On duty now")).toBeVisible();

  // Deepak hasn't signed in: not in yet → the manager marks him on leave
  const deepak = rows.filter({ hasText: "Deepak" });
  await expect(deepak.getByText("Not in yet")).toBeVisible();
  await owner.getByRole("button", { name: "Attendance for Deepak" }).click();
  await owner.getByRole("menuitem", { name: "Mark on leave" }).click();
  await expect(deepak.getByText("On leave", { exact: true })).toBeVisible();
  await expect(deepak.getByText(/marked by/)).toBeVisible();
  await ownerCtx.close();
});

test("smart tags and the Google review card reach guests", async ({ browser }) => {
  const ownerCtx = await signedInContext(browser, CONSOLE, OWNER.email, OWNER.password, "/manage");
  const api = ownerCtx.request;
  // tag a dish and set the review link the way the console does
  const items = (await (await api.get(`${E2E.api}/v1/admin/items`)).json()) as { id: string; name: string }[];
  const tikka = items.find((i) => i.name === "Paneer Tikka")!;
  expect((await api.patch(`${E2E.api}/v1/admin/items/${tikka.id}`, { data: { tags: ["BESTSELLER", "CHEFS_CHOICE"] } })).ok()).toBe(true);
  expect((await api.patch(`${E2E.api}/v1/admin/hotel`, { data: { googleReviewUrl: "https://g.page/r/e2eTest/review" } })).ok()).toBe(true);
  await ownerCtx.close();

  // the review card's address redirects to Google
  const guest = await browser.newContext();
  const r = await guest.request.get(`${CUSTOMER}/h/spice-garden/review`, { maxRedirects: 0 });
  expect(r.status()).toBe(302);
  expect(r.headers()["location"]).toBe("https://g.page/r/e2eTest/review");

  // the guest menu shows the new tag
  const { unscopedDb } = await import("@rms/db");
  const t = await unscopedDb.table.findFirstOrThrow({ where: { label: "T8", hotel: { slug: "spice-garden" } } });
  await unscopedDb.$disconnect();
  const phone = await guest.newPage();
  await phone.goto(`${CUSTOMER}/h/spice-garden/t/${t.qrToken}`);
  await phone.getByLabel("Your name").fill("Asha");
  await phone.getByRole("button", { name: "Start ordering" }).click();
  await phone.getByLabel("Search dishes").fill("Paneer Tikka");
  const card = phone.getByRole("listitem").filter({ has: phone.getByRole("heading", { name: "Paneer Tikka" }) });
  await expect(card.getByText("Chef's choice")).toBeVisible();
  await guest.close();
});
