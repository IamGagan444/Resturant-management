import { z } from "zod";

export const Id = z.string().min(1).max(64);

/** Client-generated idempotency key (cuid/uuid). */
export const ClientId = z.string().min(8).max(64);

/** Money in paise. */
export const Paise = z.number().int().nonnegative();

/** Rate in basis points (250 = 2.5%). */
export const Bps = z.number().int().min(0).max(10_000);

export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:MM");

export const Phone = z.string().regex(/^\+?\d{10,15}$/, "Invalid phone");

export const Pin = z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits");

export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(48);

/** Translations keyed by language code: { hi: { name, description } } */
export const Translations = z.record(
  z.string(),
  z.object({ name: z.string().optional(), description: z.string().optional() }),
);

export const ApiError = z.object({
  error: z.object({
    code: z.string(), // e.g. VALIDATION, NOT_FOUND, ITEM_UNAVAILABLE, SESSION_CLOSED
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
