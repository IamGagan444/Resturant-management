import { z } from "zod";
import { ClientId, Id, Paise, Phone } from "./common";
import { SessionStatus, TableStatus } from "./enums";

export const TableLookup = z.object({
  hotel: z.object({ id: Id, name: z.string(), slug: z.string() }),
  table: z.object({ id: Id, label: z.string(), status: TableStatus }),
  /** true if a session is already running at this table → joining needs the join code */
  hasOpenSession: z.boolean(),
  /** true if this device is already a guest of the open session (rejoin without code) */
  isMember: z.boolean(),
});
export type TableLookup = z.infer<typeof TableLookup>;

export const JoinSessionInput = z.object({
  qrToken: z.string().min(1),
  deviceId: z.string().min(8).max(64),
  name: z.string().trim().min(1).max(40),
  phone: Phone.optional(),
  joinCode: z.string().regex(/^\d{4}$/).optional(),
});
export type JoinSessionInput = z.infer<typeof JoinSessionInput>;

export const Guest = z.object({ id: Id, displayName: z.string(), isHost: z.boolean() });
export type Guest = z.infer<typeof Guest>;

export const CartItem = z.object({
  id: Id,
  guestId: Id,
  guestName: z.string(),
  itemId: Id,
  name: z.string(),
  variantId: Id.nullable(),
  variantName: z.string().nullable(),
  addonIds: z.array(Id),
  addonNames: z.array(z.string()),
  quantity: z.number().int().min(1).max(50),
  note: z.string().max(140).nullable(),
  /** Server-computed. 0 when the line is no longer valid (item went out of stock etc.). */
  unitPrice: Paise,
  lineTotal: Paise,
  isValid: z.boolean(),
});
export type CartItem = z.infer<typeof CartItem>;

/** PUT /p/cart/items/:id — id is client-generated, so upsert is naturally idempotent. */
export const UpsertCartItemInput = z.object({
  itemId: Id,
  variantId: Id.nullish(),
  addonIds: z.array(Id).max(20).default([]),
  quantity: z.number().int().min(1).max(50),
  note: z.string().trim().max(140).nullish(),
});
export type UpsertCartItemInput = z.infer<typeof UpsertCartItemInput>;

export const Cart = z.object({
  items: z.array(CartItem),
  /** Server-computed, never trusted from the client. */
  subtotal: Paise,
});
export type Cart = z.infer<typeof Cart>;

export const SessionView = z.object({
  id: Id,
  status: SessionStatus,
  tableLabel: z.string(),
  joinCode: z.string().nullable(), // only sent to the host guest and staff
  isConfirmed: z.boolean(),
  me: Guest,
  guests: z.array(Guest),
  cart: Cart,
});
export type SessionView = z.infer<typeof SessionView>;

export const ClientIdInput = z.object({ clientId: ClientId });
