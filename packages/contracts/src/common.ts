import { z } from "zod";

export const Id = z.string().min(1).max(64);

/** Client-generated idempotency key (cuid/uuid). */
export const ClientId = z.string().min(8).max(64);

/** Money in paise. */
export const Paise = z.number().int().nonnegative();

/** Rate in basis points (250 = 2.5%). */
export const Bps = z.number().int().min(0).max(10_000);

/** Absolute http(s) URL. A bare URL check would also accept javascript:, data: and file: URLs. */
export const HttpUrl = (max = 500) => z.url({ protocol: /^https?$/, message: "Enter a full address starting with https://" }).max(max);

type NoDefault<T> = T extends z.ZodDefault<infer I extends z.ZodType> ? I : T;
type PatchShape<S extends z.ZodRawShape> = { [K in keyof S]: z.ZodOptional<NoDefault<S[K]>> };

/**
 * PATCH body for a create schema: every field optional and *no defaults*. (Zod 4 applies defaults inside
 * `.partial()`, so a plain `.partial()` would silently reset fields the client didn't send.)
 */
export function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>): z.ZodObject<PatchShape<S>> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(schema.shape) as [string, z.ZodType][]) {
    shape[key] = (field instanceof z.ZodDefault ? (field.unwrap() as z.ZodType) : field).optional();
  }
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>;
}

export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

/** Mobile number. Spaces, dashes and brackets people type ("98765 43210") are dropped before checking. */
export const Phone = z.preprocess(
  (v) => (typeof v === "string" ? v.replace(/[\s\-()]/g, "") : v),
  z.string().regex(/^\+?\d{10,15}$/, "Enter a 10-digit mobile number"),
);

export const Pin = z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits");

/** Owners and managers can do everything, so their PIN is longer: 6 digits. */
export const LEAD_PIN_LENGTH = 6;
export const LeadPin = z.string().regex(/^\d{6}$/, "Owners and managers need a 6-digit PIN");
export const isLeadRole = (role: string) => role === "OWNER" || role === "MANAGER";

export const Slug = z
  .string()
  .min(3, "At least 3 characters")
  .max(48, "At most 48 characters")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and single dashes only");

/** Translations keyed by language code: { hi: { name, description } } */
export const Translations = z
  .record(z.string().max(10), z.object({ name: z.string().max(120).optional(), description: z.string().max(500).optional() }))
  .refine((t) => Object.keys(t).length <= 20, "At most 20 languages");

export const ApiError = z.object({
  error: z.object({
    code: z.string(), // e.g. VALIDATION, NOT_FOUND, ITEM_UNAVAILABLE, SESSION_CLOSED
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
