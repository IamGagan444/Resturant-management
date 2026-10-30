import { createHash } from "node:crypto";
import { db, type Hotel, type Prisma } from "@rms/db";
import type { PublicMenu } from "@rms/contracts";
import { isWithinWindow, priceLine, type PricedLine, type PricingAddonGroup, type PricingError, type PricingItem, type TaxRate } from "@rms/domain";
import { gatewayFor } from "../payments/gateway";

const itemInclude = {
  variants: { orderBy: { sortOrder: "asc" } },
  addonGroups: { include: { addons: { orderBy: { id: "asc" } } } },
  taxes: true,
  category: true,
} satisfies Prisma.MenuItemInclude;

export type MenuItemFull = Prisma.MenuItemGetPayload<{ include: typeof itemInclude }>;

type Translations = Record<string, { name?: string; description?: string }>;
const asTranslations = (v: Prisma.JsonValue | null) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Translations) : null);

/** Effective availability: item toggle + soft delete + category active + category time window. */
export function isOrderable(hotel: Hotel, item: MenuItemFull, now = new Date()): boolean {
  return (
    item.isAvailable &&
    item.isActive &&
    item.category.isActive &&
    isWithinWindow(now, hotel.timezone, item.category.availableFrom, item.category.availableTo)
  );
}

/**
 * Menu cache: every guest phone and staff screen loads the full menu, so it's built once per hotel
 * and reused for up to MENU_TTL_MS. Menu / settings writes and availability toggles clear it at once;
 * other API instances catch up within the TTL. Time windows (breakfast etc.) also flip within the TTL.
 */
const MENU_TTL_MS = 30_000;
const menuCache = new Map<string, { menu: PublicMenu; exp: number }>();

/** Clear one hotel's cached menu, or every hotel's. */
export function invalidateMenu(hotelId?: string) {
  if (hotelId) menuCache.delete(hotelId);
  else menuCache.clear();
}

/** Customer menu. The ETag is a hash of the payload, so any change (incl. availability) busts caches. */
export async function loadPublicMenu(hotel: Hotel): Promise<PublicMenu> {
  const hit = menuCache.get(hotel.id);
  if (hit && hit.exp > Date.now()) return hit.menu;
  const menu = await buildPublicMenu(hotel);
  menuCache.set(hotel.id, { menu, exp: Date.now() + MENU_TTL_MS });
  return menu;
}

async function buildPublicMenu(hotel: Hotel): Promise<PublicMenu> {
  const [categories, items] = await Promise.all([
    db.menuCategory.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.menuItem.findMany({
      where: { isActive: true, category: { isActive: true } },
      include: itemInclude,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  const groups = new Map<string, PublicMenu["addonGroups"][number]>();
  for (const it of items) {
    for (const g of it.addonGroups) {
      groups.set(g.id, {
        id: g.id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        addons: g.addons.map((a) => ({ id: a.id, name: a.name, price: a.price, isAvailable: a.isAvailable })),
      });
    }
  }
  const upiEnabled = gatewayFor(hotel) !== null;
  const body: Omit<PublicMenu, "version"> = {
    hotel: {
      id: hotel.id,
      name: hotel.name,
      slug: hotel.slug,
      currency: hotel.currency,
      timezone: hotel.timezone,
      defaultLanguage: hotel.defaultLanguage,
      pricesIncludeTax: hotel.pricesIncludeTax,
      allowPayLater: hotel.allowPayLater,
      allowPayNow: hotel.allowPayNow && upiEnabled,
      upiEnabled,
    },
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      translations: asTranslations(c.translations),
      availableFrom: c.availableFrom,
      availableTo: c.availableTo,
    })),
    items: items.map((i) => ({
      id: i.id,
      categoryId: i.categoryId,
      name: i.name,
      description: i.description,
      translations: asTranslations(i.translations),
      imageUrl: i.imageUrl,
      price: i.price,
      foodType: i.foodType,
      spiceLevel: i.spiceLevel,
      prepTimeMin: i.prepTimeMin,
      isBestseller: i.isBestseller,
      isAvailable: i.isAvailable,
      variants: i.variants.map((v) => ({ id: v.id, name: v.name, price: v.price })),
      addonGroupIds: i.addonGroups.map((g) => g.id),
    })),
    addonGroups: [...groups.values()],
  };
  const version = createHash("sha1").update(JSON.stringify(body)).digest("base64url");
  return { ...body, version };
}

export interface Selection {
  itemId: string;
  variantId?: string | null;
  addonIds: readonly string[];
  quantity: number;
}

export type PricedSelection =
  | { ok: true; item: MenuItemFull; line: PricedLine; taxes: TaxRate[] }
  | { ok: false; item: MenuItemFull | null; errors: (PricingError | { code: "ITEM_NOT_FOUND" })[] };

/** Server-side pricing for any set of selections. Client prices are never used. */
export async function priceSelections(hotel: Hotel, sels: readonly Selection[]): Promise<PricedSelection[]> {
  const ids = [...new Set(sels.map((s) => s.itemId))];
  const rows = await db.menuItem.findMany({ where: { id: { in: ids } }, include: itemInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const now = new Date();
  return sels.map((sel) => {
    const item = byId.get(sel.itemId);
    if (!item) return { ok: false, item: null, errors: [{ code: "ITEM_NOT_FOUND" }] };
    const groups = new Map<string, PricingAddonGroup>(item.addonGroups.map((g) => [g.id, g]));
    const pricing: PricingItem = {
      id: item.id,
      price: item.price,
      isAvailable: isOrderable(hotel, item, now),
      variants: item.variants,
      addonGroupIds: item.addonGroups.map((g) => g.id),
    };
    const r = priceLine(pricing, groups, sel);
    if (!r.ok) return { ok: false, item, errors: r.errors };
    return { ok: true, item, line: r.line, taxes: item.taxes.map((t) => ({ name: t.name, rateBps: t.rateBps })) };
  });
}
