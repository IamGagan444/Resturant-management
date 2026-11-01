import path from "node:path";
import { config } from "dotenv";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { E2E } from "../ports";

config({ path: path.resolve(import.meta.dirname, "../../.env") });

const OUT = process.env.SHOTS_DIR ?? path.resolve(import.meta.dirname, "../shots-out");
const OWNER = { email: "owner@spicegarden.test", password: "owner12345" };
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1366, height: 860 } } as const;
type Size = keyof typeof SIZES;

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

async function ownerPage(browser: Browser, size: Size) {
  const page = await (await browser.newContext({ viewport: SIZES[size] })).newPage();
  await page.goto(`${E2E.console}/login/`);
  await shot(page, `${size}-console-login`);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("tab", { name: "Devices" })).toBeVisible();
  return page;
}

async function pairCode(owner: Page, kind: string) {
  await owner.getByRole("tab", { name: "Devices" }).click();
  await owner.getByLabel("Name").fill(`${kind} (shots)`);
  await owner.getByRole("combobox", { name: /Used as/ }).click();
  await owner.getByRole("option", { name: kind }).click();
  await owner.getByRole("button", { name: "Get a pairing code" }).click();
  const code = (await owner.getByTestId("pair-code").textContent())?.trim() ?? "";
  await owner.keyboard.press("Escape");
  return code;
}

async function device(browser: Browser, owner: Page, size: Size, kind: string, who: string, pin: string, tag: string) {
  const code = await pairCode(owner, kind);
  const page = await (await browser.newContext({ viewport: SIZES[size] })).newPage();
  await page.goto(`${E2E.console}/device/`);
  await page.getByLabel("Pairing code").fill(code);
  await page.getByRole("button", { name: "Pair this device" }).click();
  await expect(page.getByText("Who's working?")).toBeVisible();
  await shot(page, `${size}-${tag}-picker`);
  await page.getByRole("button", { name: new RegExp(who) }).click();
  await shot(page, `${size}-${tag}-pin`);
  for (const d of pin) await page.getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Enter" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/device"));
  await shot(page, `${size}-${tag}`);
  return page;
}

for (const size of Object.keys(SIZES) as Size[]) {
  test(`console screens (${size})`, async ({ browser }) => {
    const fresh = await (await browser.newContext({ viewport: SIZES[size] })).newPage();
    await fresh.goto(`${E2E.console}/device/`);
    await shot(fresh, `${size}-device-unpaired`);

    const owner = await ownerPage(browser, size);
    for (const tab of ["Menu", "Tables", "Staff", "Devices", "Settings"]) {
      await owner.getByRole("tab", { name: tab }).click();
      await shot(owner, `${size}-manage-${tab.toLowerCase()}`);
    }
    await owner.getByRole("button", { name: "Get a pairing code" }).isVisible();
    for (const p of ["reports", "floor", "cashier"]) {
      await owner.goto(`${E2E.console}/${p}/`);
      await shot(owner, `${size}-${p}`);
    }
    await owner.goto(`${E2E.console}/manage/`);
    await device(browser, owner, size, "Waiter phone", "Ravi", "4001", "waiter");
    await device(browser, owner, size, "Kitchen screen", "Raju", "3001", "kds");

    if (process.env.SEED_ADMIN_PASSWORD) {
      const admin = await (await browser.newContext({ viewport: SIZES[size] })).newPage();
      await admin.goto(`${E2E.console}/login/`);
      await admin.getByLabel("Email").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@example.com");
      await admin.getByLabel("Password").fill(process.env.SEED_ADMIN_PASSWORD);
      await admin.getByRole("button", { name: "Sign in" }).click();
      await admin.waitForURL(/platform/);
      for (const p of ["", "restaurants/", "onboard/", "sessions/"]) {
        await admin.goto(`${E2E.console}/platform/${p}`);
        await shot(admin, `${size}-platform-${p.replace("/", "") || "home"}`);
      }
    }
  });

  test(`guest screens (${size})`, async ({ browser }) => {
    const { unscopedDb } = await import("@rms/db");
    const t = await unscopedDb.table.findFirstOrThrow({ where: { label: size === "phone" ? "T2" : "T3", hotel: { slug: "spice-garden" } } });
    await unscopedDb.$disconnect();
    const page = await (await browser.newContext({ viewport: SIZES[size] })).newPage();
    await page.goto(`${E2E.customer}/h/spice-garden/t/${t.qrToken}`);
    await shot(page, `${size}-guest-start`);
    await page.getByLabel("Your name").fill("Asha");
    await page.getByRole("button", { name: "Start ordering" }).click();
    await page.getByRole("button", { name: "ADD", exact: true }).first().waitFor();
    await shot(page, `${size}-guest-menu`);
    await page.getByRole("button", { name: "ADD", exact: true }).first().click();
    await shot(page, `${size}-guest-added`);
  });
}
