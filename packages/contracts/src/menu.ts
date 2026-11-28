import { z } from "zod";
import { Bps, HHMM, HttpUrl, Id, Paise, Translations, patchOf } from "./common";
import { FoodType } from "./enums";

// ── Admin inputs ────────────────────────────────

export const CategoryInput = z.object({
  name: z.string().min(1).max(60),
  translations: Translations.optional(),
  sortOrder: z.number().int().default(0),
  availableFrom: HHMM.nullish(),
  availableTo: HHMM.nullish(),
  isActive: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof CategoryInput>;
export const CategoryPatch = patchOf(CategoryInput);

/**
 * Smart tags a manager puts on dishes to push them (bestsellers, high-margin specials). Shown as badges on the
 * guest menu; the order here is the badge order. Labels for guests are translated in the customer app.
 */
export const DISH_TAGS = ["BESTSELLER", "CHEFS_CHOICE", "MUST_TRY", "TOP_RATED", "NEW_LAUNCH", "SPICY", "RECOMMENDED", "HEALTHY", "JAIN", "LIMITED"] as const;
export const DishTag = z.enum(DISH_TAGS);
export type DishTag = z.infer<typeof DishTag>;
export const DISH_TAG_LABELS: Record<DishTag, string> = {
  BESTSELLER: "Bestseller",
  CHEFS_CHOICE: "Chef's choice",
  MUST_TRY: "Must try",
  TOP_RATED: "Top rated",
  NEW_LAUNCH: "New launch",
  SPICY: "Spicy",
  RECOMMENDED: "Recommended",
  HEALTHY: "Healthy",
  JAIN: "Jain friendly",
  LIMITED: "Limited time",
};
/** Unique, in DISH_TAGS order, so the stored list is canonical whatever order the client sent. */
const Tags = z.array(DishTag).max(DISH_TAGS.length).transform((t) => DISH_TAGS.filter((x) => t.includes(x)));

export const VariantInput = z.object({
  id: Id.optional(),
  name: z.string().min(1).max(40),
  price: Paise,
});

export const MenuItemInput = z.object({
  categoryId: Id,
  stationId: Id.nullish(),
  name: z.string().min(1).max(80),
  translations: Translations.optional(),
  description: z.string().max(300).nullish(),
  imageUrl: HttpUrl(500).nullish(),
  /** 3D model (.glb) for the 3D / AR view; uploaded through /v1/admin/uploads/model */
  modelUrl: HttpUrl(500).nullish(),
  price: Paise,
  foodType: FoodType.default("VEG"),
  spiceLevel: z.number().int().min(0).max(3).nullish(),
  prepTimeMin: z.number().int().min(1).max(180).default(15),
  tags: Tags.default([]),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  taxIds: z.array(Id).max(20).default([]),
  addonGroupIds: z.array(Id).max(30).default([]),
  variants: z.array(VariantInput).max(30).default([]),
});
export type MenuItemInput = z.infer<typeof MenuItemInput>;
export const MenuItemPatch = patchOf(MenuItemInput);

export const AddonGroupInput = z
  .object({
    name: z.string().min(1).max(60),
    minSelect: z.number().int().min(0).default(0),
    maxSelect: z.number().int().min(1).default(1),
    addons: z.array(
      z.object({ id: Id.optional(), name: z.string().min(1).max(60), price: Paise.default(0), isAvailable: z.boolean().default(true) }),
    ).max(50),
  })
  .refine((g) => g.minSelect <= g.maxSelect, { message: "minSelect must be <= maxSelect" });
export type AddonGroupInput = z.infer<typeof AddonGroupInput>;

export const TaxInput = z.object({ name: z.string().min(1).max(30), rateBps: Bps });
export type TaxInput = z.infer<typeof TaxInput>;
export const TaxPatch = patchOf(TaxInput);

// ── Public menu (customer) ──────────────────────

export const PublicAddon = z.object({ id: Id, name: z.string(), price: Paise, isAvailable: z.boolean() });
export const PublicAddonGroup = z.object({
  id: Id,
  name: z.string(),
  minSelect: z.number().int(),
  maxSelect: z.number().int(),
  addons: z.array(PublicAddon),
});
export const PublicVariant = z.object({ id: Id, name: z.string(), price: Paise });

export const PublicMenuItem = z.object({
  id: Id,
  categoryId: Id,
  name: z.string(),
  description: z.string().nullable(),
  translations: Translations.nullable(),
  imageUrl: z.string().nullable(),
  modelUrl: z.string().nullable().optional(),
  price: Paise,
  foodType: FoodType,
  spiceLevel: z.number().int().nullable(),
  prepTimeMin: z.number().int(),
  tags: z.array(DishTag).optional(),
  /** = tags includes BESTSELLER (kept for the local hub and older screens) */
  isBestseller: z.boolean(),
  isAvailable: z.boolean(),
  variants: z.array(PublicVariant),
  addonGroupIds: z.array(Id),
});
export type PublicMenuItem = z.infer<typeof PublicMenuItem>;

export const PublicCategory = z.object({
  id: Id,
  name: z.string(),
  translations: Translations.nullable(),
  availableFrom: z.string().nullable(),
  availableTo: z.string().nullable(),
});

export const PublicMenu = z.object({
  hotel: z.object({
    id: Id,
    name: z.string(),
    slug: z.string(),
    currency: z.string(),
    timezone: z.string(),
    defaultLanguage: z.string(),
    pricesIncludeTax: z.boolean(),
    allowPayLater: z.boolean(),
    allowPayNow: z.boolean(), // false unless UPI is configured too
    upiEnabled: z.boolean(),
    /** a Google review link is set: show "Rate us on Google" after paying */
    reviewEnabled: z.boolean().optional(),
  }),
  categories: z.array(PublicCategory),
  items: z.array(PublicMenuItem),
  addonGroups: z.array(PublicAddonGroup),
  version: z.string(), // ETag source
});
export type PublicMenu = z.infer<typeof PublicMenu>;
