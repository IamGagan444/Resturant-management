import { z } from "zod";

// Mirrors the Prisma enums so browser bundles never import @prisma/client.
// packages/db has a test that fails if these drift from schema.prisma.

export const StaffRole = z.enum(["OWNER", "MANAGER", "CASHIER", "COOK", "WAITER"]);
export type StaffRole = z.infer<typeof StaffRole>;

export const HotelStatus = z.enum(["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"]);
export type HotelStatus = z.infer<typeof HotelStatus>;

export const TableStatus = z.enum(["FREE", "OCCUPIED", "BILL_REQUESTED", "CLEANING", "RESERVED"]);
export type TableStatus = z.infer<typeof TableStatus>;

export const SessionStatus = z.enum(["OPEN", "BILLING", "CLOSED"]);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const OrderSource = z.enum(["QR_CUSTOMER", "WAITER", "COUNTER"]);
export type OrderSource = z.infer<typeof OrderSource>;

export const OrderStatus = z.enum([
  "AWAITING_PAYMENT",
  "PENDING_CONFIRMATION",
  "PLACED",
  "IN_PROGRESS",
  "READY",
  "SERVED",
  "CANCELLED",
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

export const ItemStatus = z.enum(["QUEUED", "COOKING", "READY", "PICKED_UP", "SERVED", "CANCELLED", "OUT_OF_STOCK"]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const FoodType = z.enum(["VEG", "NON_VEG", "EGG", "VEGAN"]);
export type FoodType = z.infer<typeof FoodType>;

export const RequestType = z.enum(["CALL_WAITER", "WATER", "CUTLERY", "BILL", "OTHER"]);
export type RequestType = z.infer<typeof RequestType>;

export const RequestStatus = z.enum(["OPEN", "ACKNOWLEDGED", "DONE"]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const BillStatus = z.enum(["OPEN", "PARTIALLY_PAID", "PAID", "VOID"]);
export type BillStatus = z.infer<typeof BillStatus>;

export const SplitType = z.enum(["NONE", "EQUAL", "BY_GUEST", "BY_ITEM"]);
export type SplitType = z.infer<typeof SplitType>;

export const PaymentMethod = z.enum(["UPI", "CASH", "CARD", "ROOM_CHARGE"]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

export const PaymentStatus = z.enum(["PENDING", "SUCCESS", "FAILED", "REFUNDED"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const DeviceKind = z.enum(["KDS", "WAITER", "POS", "MANAGER", "HUB"]);
export type DeviceKind = z.infer<typeof DeviceKind>;

export const Language = z.enum(["en", "hi", "or", "te"]);
export type Language = z.infer<typeof Language>;
