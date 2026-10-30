import { z } from "zod";
import { Bps, Id, Paise } from "./common";
import { PaymentMethod, TableStatus } from "./enums";

/** GET /s/reports/day?date=YYYY-MM-DD — end-of-day summary for one business date. */
export const DayReport = z.object({
  date: z.string(),
  from: z.string(),
  to: z.string(),
  bills: z.object({
    count: z.number().int(),
    subtotal: Paise,
    discount: Paise,
    serviceCharge: Paise,
    taxTotal: Paise,
    roundOff: z.number().int(),
    total: Paise,
    averageBill: Paise,
  }),
  taxLines: z.array(z.object({ name: z.string(), rateBps: Bps, taxable: Paise, amount: Paise })),
  payments: z.array(z.object({ method: PaymentMethod, count: z.number().int(), amount: Paise })),
  orders: z.object({ count: z.number().int(), qr: z.number().int(), waiter: z.number().int(), cancelledItems: z.number().int(), outOfStockItems: z.number().int() }),
  topItems: z.array(z.object({ name: z.string(), quantity: z.number().int(), amount: Paise })),
  discounts: z.array(z.object({ billNumber: z.string().nullable(), amount: Paise, reason: z.string().nullable() })),
  open: z.object({ sessions: z.number().int(), due: Paise }),
});
export type DayReport = z.infer<typeof DayReport>;

/** GET /s/floor — manager live floor map. */
export const FloorTable = z.object({
  id: Id,
  label: z.string(),
  floorId: Id.nullable(),
  seats: z.number().int(),
  posX: z.number().int().nullable(),
  posY: z.number().int().nullable(),
  status: TableStatus,
  session: z
    .object({
      id: Id,
      guestCount: z.number().int(),
      openedAt: z.string(),
      total: Paise,
      due: Paise,
      cooking: z.number().int(),
      ready: z.number().int(),
      openRequests: z.number().int(),
      pendingConfirm: z.boolean(),
    })
    .nullable(),
});
export type FloorTable = z.infer<typeof FloorTable>;

export const FloorView = z.object({
  floors: z.array(z.object({ id: Id, name: z.string() })),
  tables: z.array(FloorTable),
  /** READY items waiting longer than the hotel's pickup alert. */
  escalations: z.array(z.object({ orderItemId: Id, tableLabel: z.string(), itemName: z.string(), waitingSec: z.number().int() })),
});
export type FloorView = z.infer<typeof FloorView>;

export const TablePositionsInput = z.object({
  tables: z.array(z.object({ id: Id, posX: z.number().int().min(0).max(100), posY: z.number().int().min(0).max(100) })).max(500),
});
export type TablePositionsInput = z.infer<typeof TablePositionsInput>;

/** Everything the audit log records: voids, cancellations, discounts, price and stock changes, hub changes. */
export const AuditAction = z.enum([
  "ORDER_CANCELLED",
  "ORDER_REJECTED",
  "ITEM_CANCELLED",
  "ITEM_OUT_OF_STOCK",
  "MENU_AVAILABILITY",
  "DISCOUNT_APPLIED",
  "SERVICE_CHARGE_REMOVED",
  "PRICE_CHANGED",
  "BILL_VOIDED",
  "QR_ROTATED",
  "STAFF_PIN_RESET",
  "BILL_SPLIT",
  "BILL_SENT",
  "ITEM_REPLACED",
  "HUB_PAIRED",
  "HUB_REMOVED",
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEntry = z.object({
  id: Id,
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  meta: z.unknown(),
  createdAt: z.string(),
  actor: z.object({ id: Id, name: z.string(), role: z.string() }).nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

/** GET /v1/admin/audit?action=&before= — newest first; `next` is the cursor for the following page. */
export const AuditPage = z.object({ entries: z.array(AuditEntry), next: z.string().nullable() });
export type AuditPage = z.infer<typeof AuditPage>;

/** Offline / hub commands the server refused (e.g. cancelling something already served). */
export const SyncRejectionView = z.object({
  id: Id,
  clientId: z.string(),
  reason: z.string(),
  command: z.unknown(),
  device: z.string().nullable(),
  createdAt: z.string(),
});
export type SyncRejectionView = z.infer<typeof SyncRejectionView>;
