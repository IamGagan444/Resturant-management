import { z } from "zod";
import { Bps, ClientId, Id, Paise, Phone } from "./common";
import { BillStatus, PaymentMethod, PaymentStatus, SplitType } from "./enums";

export const BillTaxLineView = z.object({ name: z.string(), rateBps: Bps, taxable: Paise, amount: Paise });

export const BillLineView = z.object({
  orderItemId: Id,
  name: z.string(),
  variantName: z.string().nullable(),
  addons: z.array(z.string()),
  quantity: z.number().int(),
  unitPrice: Paise,
  amount: Paise,
  guestId: Id.nullable(),
  guestName: z.string().nullable(),
  splitId: Id.nullable(),
});
export type BillLineView = z.infer<typeof BillLineView>;

export const BillSplitView = z.object({ id: Id, label: z.string(), amount: Paise, paid: Paise, isPaid: z.boolean() });
export type BillSplitView = z.infer<typeof BillSplitView>;

export const BillView = z.object({
  id: Id,
  sessionId: Id,
  tableLabel: z.string(),
  billNumber: z.string().nullable(),
  lines: z.array(BillLineView),
  subtotal: Paise,
  discount: Paise,
  serviceCharge: Paise,
  serviceChargeBps: Bps,
  taxTotal: Paise,
  roundOff: z.number().int(), // can be negative
  total: Paise,
  paid: Paise,
  due: Paise,
  pricesIncludeTax: z.boolean(),
  splitType: SplitType,
  status: BillStatus,
  taxLines: z.array(BillTaxLineView),
  splits: z.array(BillSplitView),
  /** Some guest is mid-UPI on this bill (blocks a second full payment). */
  paymentInFlight: z.boolean(),
  /** Digital receipt (set once PAID): share on WhatsApp / SMS. */
  receiptUrl: z.string().nullable(),
});
export type BillView = z.infer<typeof BillView>;

/** PATCH /s/bills/:id — cashier adjustments. Discounts are audited. */
export const AdjustBillInput = z.object({
  discount: Paise.optional(),
  discountReason: z.string().max(140).optional(),
  removeServiceCharge: z.boolean().optional(),
});
export type AdjustBillInput = z.infer<typeof AdjustBillInput>;

export const SplitBillInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NONE") }),
  z.object({ type: z.literal("EQUAL"), parts: z.number().int().min(2).max(20) }),
  z.object({ type: z.literal("BY_GUEST") }),
  z.object({
    type: z.literal("BY_ITEM"),
    groups: z.array(z.object({ label: z.string().max(40), orderItemIds: z.array(Id).min(1) })).min(2),
  }),
]);
export type SplitBillInput = z.infer<typeof SplitBillInput>;

/** POST /s/payments — cash/card collected by staff. */
export const RecordPaymentInput = z.object({
  clientId: ClientId,
  billId: Id,
  splitId: Id.optional(),
  method: z.enum(["CASH", "CARD"]),
  amount: Paise.positive(),
});
export type RecordPaymentInput = z.infer<typeof RecordPaymentInput>;

/** POST /p/payments/upi — creates a gateway order; amount is computed server-side. */
export const StartUpiPaymentInput = z.object({
  clientId: ClientId,
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("ORDER"), orderId: Id }), // pay-now checkout
    z.object({ kind: z.literal("BILL"), billId: Id, splitId: Id.optional() }),
  ]),
});
export type StartUpiPaymentInput = z.infer<typeof StartUpiPaymentInput>;

export const UpiCheckout = z.object({
  paymentId: Id,
  gateway: z.literal("razorpay"),
  keyId: z.string(),
  gatewayOrderId: z.string(),
  amount: Paise,
  currency: z.string(),
});
export type UpiCheckout = z.infer<typeof UpiCheckout>;

export const PaymentView = z.object({
  id: Id,
  method: PaymentMethod,
  amount: Paise,
  status: PaymentStatus,
  createdAt: z.string(),
});
export type PaymentView = z.infer<typeof PaymentView>;

/** POST /s/bills/:id/send — share the digital bill. We return deep links; staff tap to send. */
export const SendBillInput = z.object({ phone: Phone });
export type SendBillInput = z.infer<typeof SendBillInput>;
export const SendBillResult = z.object({ receiptUrl: z.string(), whatsappUrl: z.string(), smsUrl: z.string() });
export type SendBillResult = z.infer<typeof SendBillResult>;

/** GET /r/:token — public digital receipt (GST invoice). */
export const ReceiptView = z.object({
  hotel: z.object({ name: z.string(), address: z.string().nullable(), phone: z.string().nullable(), gstin: z.string().nullable(), timezone: z.string() }),
  bill: BillView,
  closedAt: z.string().nullable(),
  payments: z.array(z.object({ method: PaymentMethod, amount: Paise })),
});
export type ReceiptView = z.infer<typeof ReceiptView>;
