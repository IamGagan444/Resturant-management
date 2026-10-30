import { sum } from "./money";

/** Minimal menu shapes the pricing logic needs (server passes DB rows, client passes the public menu). */
export interface PricingItem {
  id: string;
  price: number;
  isAvailable: boolean;
  variants: readonly { id: string; name: string; price: number }[];
  addonGroupIds: readonly string[];
}

export interface PricingAddonGroup {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  addons: readonly { id: string; name: string; price: number; isAvailable: boolean }[];
}

export interface LineSelection {
  variantId?: string | null;
  addonIds: readonly string[];
  quantity: number;
}

export type PricingError =
  | { code: "ITEM_UNAVAILABLE" }
  | { code: "VARIANT_REQUIRED" }
  | { code: "VARIANT_INVALID" }
  | { code: "ADDON_INVALID"; addonId: string }
  | { code: "ADDON_UNAVAILABLE"; addonId: string }
  | { code: "ADDON_DUPLICATE"; addonId: string }
  | { code: "ADDON_GROUP_MIN"; groupId: string; min: number }
  | { code: "ADDON_GROUP_MAX"; groupId: string; max: number }
  | { code: "QUANTITY_INVALID" };

export interface PricedLine {
  unitPrice: number;
  lineTotal: number;
  variantName: string | null;
  addons: { id: string; name: string; price: number }[];
}

/**
 * Validate a selection against the menu and compute its price.
 * Server always calls this — prices from the client are never trusted.
 */
export function priceLine(
  item: PricingItem,
  groups: ReadonlyMap<string, PricingAddonGroup>,
  sel: LineSelection,
): { ok: true; line: PricedLine } | { ok: false; errors: PricingError[] } {
  const errors: PricingError[] = [];
  if (!item.isAvailable) errors.push({ code: "ITEM_UNAVAILABLE" });
  if (!Number.isInteger(sel.quantity) || sel.quantity < 1) errors.push({ code: "QUANTITY_INVALID" });

  let base = item.price;
  let variantName: string | null = null;
  if (item.variants.length > 0) {
    if (!sel.variantId) errors.push({ code: "VARIANT_REQUIRED" });
    else {
      const v = item.variants.find((x) => x.id === sel.variantId);
      if (!v) errors.push({ code: "VARIANT_INVALID" });
      else {
        base = v.price;
        variantName = v.name;
      }
    }
  } else if (sel.variantId) errors.push({ code: "VARIANT_INVALID" });

  const chosen: PricedLine["addons"] = [];
  const perGroup = new Map<string, number>();
  const seen = new Set<string>();
  for (const addonId of sel.addonIds) {
    if (seen.has(addonId)) {
      errors.push({ code: "ADDON_DUPLICATE", addonId });
      continue;
    }
    seen.add(addonId);
    let found: { group: PricingAddonGroup; addon: PricingAddonGroup["addons"][number] } | undefined;
    for (const gid of item.addonGroupIds) {
      const g = groups.get(gid);
      const a = g?.addons.find((x) => x.id === addonId);
      if (g && a) {
        found = { group: g, addon: a };
        break;
      }
    }
    if (!found) {
      errors.push({ code: "ADDON_INVALID", addonId });
      continue;
    }
    if (!found.addon.isAvailable) errors.push({ code: "ADDON_UNAVAILABLE", addonId });
    perGroup.set(found.group.id, (perGroup.get(found.group.id) ?? 0) + 1);
    chosen.push({ id: found.addon.id, name: found.addon.name, price: found.addon.price });
  }

  for (const gid of item.addonGroupIds) {
    const g = groups.get(gid);
    if (!g) continue;
    const n = perGroup.get(gid) ?? 0;
    if (n < g.minSelect) errors.push({ code: "ADDON_GROUP_MIN", groupId: gid, min: g.minSelect });
    if (n > g.maxSelect) errors.push({ code: "ADDON_GROUP_MAX", groupId: gid, max: g.maxSelect });
  }

  if (errors.length > 0) return { ok: false, errors };
  const unitPrice = base + sum(chosen.map((a) => a.price));
  return { ok: true, line: { unitPrice, lineTotal: unitPrice * sel.quantity, variantName, addons: chosen } };
}
