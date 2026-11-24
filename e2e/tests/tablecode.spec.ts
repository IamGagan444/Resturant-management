import { expect, test } from "@playwright/test";
import { E2E } from "../ports";

/** Camera won't scan: the guest types the code printed under the QR, then orders a dish as parcel. */
test("typed table code: validation, then parcel order", async ({ browser }) => {
  const { unscopedDb } = await import("@rms/db");
  const t = await unscopedDb.table.findFirstOrThrow({ where: { label: "T7", hotel: { slug: "spice-garden" } } });
  await unscopedDb.$disconnect();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${E2E.customer}/`, { waitUntil: "networkidle" });
  const code = page.getByLabel("Can't scan? Type the table code");
  const open = page.getByRole("button", { name: "Open menu" });

  await open.click();
  await expect(page.getByText("Enter the table code")).toBeVisible();
  await code.fill("AB1");
  await expect(page.getByText(/never use 0, O, 1, I/)).toBeVisible();
  await code.fill("ABC");
  await open.click();
  await expect(page.getByText("3 more to go")).toBeVisible();
  await code.fill(t.code === "ZZZZZZ" ? "YYYYYY" : "ZZZZZZ");
  await open.click();
  await expect(page.getByText(/No table has that code/)).toBeVisible();
  await code.fill(`${t.code.slice(0, 3).toLowerCase()} - ${t.code.slice(3)}`);
  await open.click();
  await expect(page.getByText(/Table T7/)).toBeVisible();

  await page.getByLabel("Your name").fill("Ila");
  await page.getByRole("button", { name: "Start ordering" }).click();
  await page.getByLabel("Search dishes").fill("Butter Naan");
  await page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Butter Naan" }) }).getByRole("button", { name: "ADD" }).click();
  await page.getByRole("checkbox", { name: /Parcel this/ }).check();
  await page.getByRole("button", { name: /^Add · / }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  const line = page.getByRole("checkbox", { name: "Parcel: Butter Naan" });
  await expect(line).toBeChecked();
  await page.getByLabel("Parcel everything").click();
  await expect(line).not.toBeChecked();
  await page.getByLabel("Parcel everything").click();
  await expect(line).toBeChecked();
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/cart.png` });
  await page.getByRole("button", { name: "Order now, pay later" }).click();
  await expect(page.getByText("Order #")).toBeVisible();
  await expect(page.getByText("Parcel", { exact: true })).toBeVisible();
  await ctx.close();
});

/** Walk-in parcel: scan the counter QR, pay, follow the token, even after reloading the page. */
test("parcel counter: order, pay now, follow the token until it's handed over", async ({ browser }) => {
  const { unscopedDb } = await import("@rms/db");
  const hotel = await unscopedDb.hotel.findFirstOrThrow({ where: { slug: "spice-garden" } });
  const where = { hotelId_label: { hotelId: hotel.id, label: "Parcel counter" } };
  const counter = await unscopedDb.table.upsert({ where, create: { hotelId: hotel.id, label: "Parcel counter", isParcelCounter: true }, update: {} });

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${E2E.customer}/h/spice-garden/t/${counter.qrToken}`);
  await expect(page.getByText("Parcel order")).toBeVisible();
  await page.getByLabel("Your name").fill("Ravi");
  await page.getByRole("button", { name: "Start ordering" }).click();
  const token = page.getByText(/^Parcel \d+$/).first();
  await expect(token).toBeVisible();
  const label = (await token.textContent()) ?? "";
  await page.getByLabel("Search dishes").fill("Butter Naan");
  await page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Butter Naan" }) }).getByRole("button", { name: "ADD" }).click();
  await expect(page.getByRole("checkbox", { name: /Parcel this/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Add · / }).click();
  await page.getByRole("button", { name: /View cart/ }).click();
  await page.getByRole("button", { name: /Pay now by UPI/ }).click();

  await expect(page.getByText("Your parcel is being prepared")).toBeVisible();
  await page.reload();
  await expect(page.getByText(label, { exact: true })).toBeVisible();
  if (process.env.SHOTS_DIR) await page.screenshot({ path: `${process.env.SHOTS_DIR}/parcel.png` });
  const items = { order: { session: { tableId: counter.id } } };
  await unscopedDb.orderItem.updateMany({ where: items, data: { status: "READY", readyAt: new Date() } });
  await expect(page.getByText("Ready! Collect it at the counter.")).toBeVisible();
  await unscopedDb.orderItem.updateMany({ where: items, data: { status: "SERVED" } });
  await expect(page.getByText("Parcel handed over. Enjoy!")).toBeVisible();
  await page.getByRole("button", { name: "Order again" }).click();
  await expect(page.getByText("Parcel order")).toBeVisible();
  await unscopedDb.$disconnect();
  await ctx.close();
});
