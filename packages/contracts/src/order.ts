import { z } from "zod";
import { ClientId, Id, Paise } from "./common";
import { ItemStatus, OrderSource, OrderStatus, RequestStatus, RequestType } from "./enums";

/** POST /p/orders — checkout the shared cart. */
export const PlaceOrderInput = z.object({
  clientId: ClientId,
  payment: z.enum(["PAY_LATER", "PAY_NOW"]),
  note: z.string().trim().max(200).optional(),
});
export type PlaceOrderInput = z.infer<typeof PlaceOrderInput>;

/** POST /s/orders — waiter places on a customer's behalf (no cart; lines inline). */
export const StaffOrderLine = z.object({
  itemId: Id,
  variantId: Id.nullish(),
  addonIds: z.array(Id).default([]),
  quantity: z.number().int().min(1).max(50),
  note: z.string().trim().max(140).nullish(),
});
export const StaffPlaceOrderInput = z.object({
  clientId: ClientId,
  tableId: Id,
  lines: z.array(StaffOrderLine).min(1).max(100),
  note: z.string().trim().max(200).optional(),
});
export type StaffPlaceOrderInput = z.infer<typeof StaffPlaceOrderInput>;

export const OrderItemView = z.object({
  id: Id,
  orderId: Id,
  itemId: Id,
  guestId: Id.nullable(),
  stationId: Id.nullable(),
  name: z.string(),
  variantName: z.string().nullable(),
  addons: z.array(z.object({ name: z.string(), price: Paise })),
  unitPrice: Paise,
  quantity: z.number().int(),
  note: z.string().nullable(),
  status: ItemStatus,
  startedAt: z.string().nullable(),
  readyAt: z.string().nullable(),
  pickedUpAt: z.string().nullable(),
  servedAt: z.string().nullable(),
  updatedAt: z.string(),
});
export type OrderItemView = z.infer<typeof OrderItemView>;

export const OrderView = z.object({
  id: Id,
  sessionId: Id,
  tableLabel: z.string(),
  orderNumber: z.number().int(),
  source: OrderSource,
  status: OrderStatus,
  note: z.string().nullable(),
  etaAt: z.string().nullable(),
  placedAt: z.string(),
  items: z.array(OrderItemView),
});
export type OrderView = z.infer<typeof OrderView>;

/** Kitchen display ticket: one order, only the items for the requested station. */
export const KdsTicket = OrderView.extend({
  items: z.array(OrderItemView.extend({ prepTimeMin: z.number().int() })),
});
export type KdsTicket = z.infer<typeof KdsTicket>;

/** POST /s/order-items/:id/transition — the only way item status changes. Forward-only. */
export const ItemTransitionInput = z.object({
  clientId: ClientId,
  to: ItemStatus,
  reason: z.string().max(140).optional(), // required for CANCELLED
});
export type ItemTransitionInput = z.infer<typeof ItemTransitionInput>;

/** POST /p/order-items/:id/replace — customer picks a replacement for an OUT_OF_STOCK item. */
export const ReplaceItemInput = z.object({
  clientId: ClientId,
  itemId: Id,
  variantId: Id.nullish(),
  addonIds: z.array(Id).default([]),
});
export type ReplaceItemInput = z.infer<typeof ReplaceItemInput>;

export const CreateRequestInput = z.object({
  clientId: ClientId,
  type: RequestType,
  note: z.string().trim().max(140).optional(),
});
export type CreateRequestInput = z.infer<typeof CreateRequestInput>;

export const ServiceRequestView = z.object({
  id: Id,
  sessionId: Id,
  tableLabel: z.string(),
  type: RequestType,
  note: z.string().nullable(),
  status: RequestStatus,
  createdAt: z.string(),
});
export type ServiceRequestView = z.infer<typeof ServiceRequestView>;
