import { describe, expect, it } from "vitest";
import { priceLine, type PricingAddonGroup, type PricingItem } from "./pricing";

const bread: PricingAddonGroup = {
  id: "g_bread",
  name: "Choose bread",
  minSelect: 1,
  maxSelect: 1,
  addons: [
    { id: "a_naan", name: "Naan", price: 0, isAvailable: true },
    { id: "a_garlic", name: "Garlic naan", price: 3000, isAvailable: true },
    { id: "a_kulcha", name: "Kulcha", price: 2000, isAvailable: false },
  ],
};
const extras: PricingAddonGroup = {
  id: "g_extra",
  name: "Extras",
  minSelect: 0,
  maxSelect: 2,
  addons: [
    { id: "a_cheese", name: "Cheese", price: 4000, isAvailable: true },
    { id: "a_butter", name: "Butter", price: 2000, isAvailable: true },
    { id: "a_onion", name: "Onion", price: 1000, isAvailable: true },
  ],
};
const groups = new Map([bread, extras].map((g) => [g.id, g]));

const paneer: PricingItem = {
  id: "i_paneer",
  price: 25000,
  isAvailable: true,
  variants: [
    { id: "v_half", name: "Half", price: 18000 },
    { id: "v_full", name: "Full", price: 30000 },
  ],
  addonGroupIds: ["g_bread", "g_extra"],
};

describe("priceLine", () => {
  it("uses variant price plus addons, times quantity", () => {
    const r = priceLine(paneer, groups, { variantId: "v_full", addonIds: ["a_garlic", "a_cheese"], quantity: 2 });
    expect(r).toEqual({
      ok: true,
      line: {
        unitPrice: 30000 + 3000 + 4000,
        lineTotal: 74000,
        variantName: "Full",
        addons: [
          { id: "a_garlic", name: "Garlic naan", price: 3000 },
          { id: "a_cheese", name: "Cheese", price: 4000 },
        ],
      },
    });
  });

  it("requires a variant when the item has variants", () => {
    const r = priceLine(paneer, groups, { addonIds: ["a_naan"], quantity: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual({ code: "VARIANT_REQUIRED" });
  });

  it("enforces group min/max, availability, membership and duplicates", () => {
    const r = priceLine(paneer, groups, {
      variantId: "v_half",
      addonIds: ["a_kulcha", "a_cheese", "a_butter", "a_onion", "a_cheese", "a_alien"],
      quantity: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual(
        expect.arrayContaining([
          { code: "ADDON_UNAVAILABLE", addonId: "a_kulcha" },
          { code: "ADDON_DUPLICATE", addonId: "a_cheese" },
          { code: "ADDON_INVALID", addonId: "a_alien" },
          { code: "ADDON_GROUP_MAX", groupId: "g_extra", max: 2 },
        ]),
      );
    }
    const missing = priceLine(paneer, groups, { variantId: "v_half", addonIds: [], quantity: 1 });
    expect(!missing.ok && missing.errors).toContainEqual({ code: "ADDON_GROUP_MIN", groupId: "g_bread", min: 1 });
  });

  it("rejects unavailable items and bad quantities", () => {
    const r = priceLine({ ...paneer, isAvailable: false }, groups, { variantId: "v_half", addonIds: ["a_naan"], quantity: 0 });
    expect(!r.ok && r.errors).toEqual(expect.arrayContaining([{ code: "ITEM_UNAVAILABLE" }, { code: "QUANTITY_INVALID" }]));
  });
});
