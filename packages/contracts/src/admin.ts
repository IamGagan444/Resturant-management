import { z } from "zod";
import { Bps, HHMM, Id, Phone, Pin, Slug } from "./common";
import { DeviceKind, HotelStatus, Language, StaffRole, TableStatus } from "./enums";

// ── Auth ────────────────────────────────────────

export const LoginInput = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
export type LoginInput = z.infer<typeof LoginInput>;

export const PinLoginInput = z.object({ staffId: Id, pin: Pin });
export type PinLoginInput = z.infer<typeof PinLoginInput>;

export const DevicePairInput = z.object({
  name: z.string().trim().min(1).max(40),
  kind: DeviceKind.exclude(["HUB"]), // hubs pair via POST /v1/admin/hub
  stationId: Id.nullish(),
});
export type DevicePairInput = z.infer<typeof DevicePairInput>;

export const Me = z.discriminatedUnion("typ", [
  z.object({ typ: z.literal("platform"), id: Id, name: z.string(), email: z.string(), role: z.string() }),
  z.object({
    typ: z.literal("staff"),
    id: Id,
    name: z.string(),
    role: StaffRole,
    hotel: z.object({ id: Id, name: z.string(), slug: z.string() }),
    deviceId: Id.nullable(),
    stationId: Id.nullable(),
  }),
]);
export type Me = z.infer<typeof Me>;

// ── Hotel settings (manager) ───────────────────

/** Indian GST number, e.g. 21ABCDE1234F1Z5. */
export const Gstin = z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/, "Enter a valid 15-character GSTIN, e.g. 21ABCDE1234F1Z5");

export const HotelSettingsInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    phone: Phone.nullable(),
    address: z.string().trim().max(300).nullable(),
    gstin: Gstin.nullable(),
    invoicePrefix: z.string().regex(/^[A-Z0-9]{1,4}$/, "1–4 capital letters/digits"),
    defaultLanguage: Language,
    requireWaiterConfirm: z.boolean(),
    allowPayLater: z.boolean(),
    allowPayNow: z.boolean(),
    pricesIncludeTax: z.boolean(),
    serviceChargeBps: Bps.max(2000),
    readyPickupAlertSec: z.number().int().min(30).max(1800),
    sessionIdleMin: z.number().int().min(15).max(24 * 60),
    dayStartsAt: HHMM,
    razorpay: z.object({
      keyId: z.string().min(1).max(64),
      keySecret: z.string().min(1).max(128),
      webhookSecret: z.string().min(1).max(128),
    }),
  })
  .partial();
export type HotelSettingsInput = z.infer<typeof HotelSettingsInput>;

export const StationInput = z.object({ name: z.string().trim().min(1).max(40), color: z.string().max(20).nullish() });
export type StationInput = z.infer<typeof StationInput>;

export const FloorInput = z.object({ name: z.string().trim().min(1).max(40), sortOrder: z.number().int().default(0) });
export type FloorInput = z.infer<typeof FloorInput>;

export const TableInput = z.object({
  label: z.string().trim().min(1).max(20),
  floorId: Id.nullish(),
  seats: z.number().int().min(1).max(50).default(4),
  isRoom: z.boolean().default(false),
  posX: z.number().int().nullish(),
  posY: z.number().int().nullish(),
  isActive: z.boolean().default(true),
});
export type TableInput = z.infer<typeof TableInput>;

export const TableStatusInput = z.object({ status: z.enum(["FREE", "CLEANING", "RESERVED"]) });

export const StaffCreateInput = z.object({
  name: z.string().trim().min(1).max(60),
  role: StaffRole,
  phone: Phone.nullish(),
  email: z.string().email().nullish(),
  password: z.string().min(8, "At least 8 characters").max(200).nullish(), // owners/managers who use the web admin
  pin: Pin,
  stationId: Id.nullish(),
  language: Language.default("en"),
});
export type StaffCreateInput = z.infer<typeof StaffCreateInput>;

export const StaffUpdateInput = StaffCreateInput.omit({ pin: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type StaffUpdateInput = z.infer<typeof StaffUpdateInput>;

export const ResetPinInput = z.object({ pin: Pin });

export const AssignmentsInput = z.object({
  /** defaults to the hotel's current business day */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  assignments: z.array(z.object({ tableId: Id, staffId: Id })).max(500),
});
export type AssignmentsInput = z.infer<typeof AssignmentsInput>;

export const AvailabilityInput = z.object({ isAvailable: z.boolean(), clientId: z.string().optional() });

// ── Platform (super admin) ─────────────────────

export const CreateHotelInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: Slug,
  phone: Phone.nullish(),
  address: z.string().trim().max(300).nullish(),
  gstin: Gstin.nullish(),
  planId: Id.nullish(),
  status: HotelStatus.default("TRIAL"),
  trialEndsAt: z.string().datetime().nullish(),
  owner: z.object({
    name: z.string().trim().min(1).max(60),
    email: z.string().email(),
    password: z.string().min(8).max(200),
    phone: Phone.nullish(),
    pin: Pin,
  }),
});
export type CreateHotelInput = z.infer<typeof CreateHotelInput>;

export const UpdateHotelInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    phone: Phone.nullable(),
    address: z.string().trim().max(300).nullable(),
    gstin: Gstin.nullable(),
    status: HotelStatus,
    planId: Id.nullable(),
    trialEndsAt: z.string().datetime().nullable(),
    featureOverrides: z.record(z.string(), z.boolean()).nullable(),
  })
  .partial();
export type UpdateHotelInput = z.infer<typeof UpdateHotelInput>;

export const ResetPasswordInput = z.object({ password: z.string().min(8, "At least 8 characters").max(200) });
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput>;

/** One signed-in browser or device of a restaurant's staff, as the super admin sees it. */
export interface PlatformSession {
  id: string;
  person: { id: string; name: string; role: StaffRole; email: string | null };
  hotel: { id: string; name: string };
  device: string | null; // paired device name, or null for a web sign-in
  userAgent: string | null;
  ip: string | null;
  lastActiveAt: string;
  expiresAt: string;
}

export interface PlatformHotel {
  id: string;
  name: string;
  slug: string;
  status: HotelStatus;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  plan: { id: string; name: string } | null;
  trialEndsAt: string | null;
  owner: { id: string; name: string; email: string | null; phone: string | null } | null;
  tables: number;
  staff: number;
  ordersLast7d: number;
  createdAt: string;
}

export interface PlatformOverview {
  hotels: { total: number; byStatus: Record<HotelStatus, number>; newLast30d: number };
  activity: { ordersLast24h: number; ordersLast7d: number; liveSessions: number; staffSignedIn: number };
  problems: { failedPaymentsLast24h: number; failedSyncsLast24h: number };
  trialsEndingSoon: { id: string; name: string; trialEndsAt: string }[];
  topHotels: { id: string; name: string; orders: number }[];
  recentHotels: { id: string; name: string; status: HotelStatus; createdAt: string }[];
}

export const PlanInput = z.object({
  name: z.string().trim().min(1).max(40),
  priceMonthly: z.number().int().nonnegative(),
  maxTables: z.number().int().positive(),
  maxStaff: z.number().int().positive(),
  features: z.record(z.string(), z.boolean()),
});
export type PlanInput = z.infer<typeof PlanInput>;

// ── Waiter board ───────────────────────────────

export const BoardTable = z.object({
  id: Id,
  label: z.string(),
  floor: z.string().nullable(),
  status: TableStatus,
  session: z
    .object({
      id: Id,
      joinCode: z.string(),
      isConfirmed: z.boolean(),
      guestCount: z.number().int(),
      openedAt: z.string(),
    })
    .nullable(),
});
export type BoardTable = z.infer<typeof BoardTable>;
