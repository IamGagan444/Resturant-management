import type { StartUpiPaymentInput, UpiCheckout } from "@rms/contracts";
import { ApiError, api, newClientId } from "./api";

export class PaymentCancelled extends Error {}

export interface UpiResult {
  /** set when this payment settled the whole bill */
  receiptUrl: string | null;
}

/**
 * Pay by UPI for a pay-now order, the whole bill, or one split.
 * The server computes the amount and holds the bill for this attempt; closing the sheet releases it.
 */
export async function payByUpi(target: StartUpiPaymentInput["target"]): Promise<UpiResult> {
  const checkout = await api<UpiCheckout>("POST", "/v1/p/payments/upi", { clientId: newClientId(), target });
  if (checkout.keyId === "rzp_test_mock") {
    // Local dev: simulate Razorpay Checkout returning a signed success.
    const sig = await api<{ gatewayPaymentId: string; signature: string }>("POST", `/v1/dev/payments/${checkout.paymentId}/succeed`);
    return api<UpiResult>("POST", `/v1/p/payments/${checkout.paymentId}/verify`, sig);
  }
  try {
    return await openRazorpay(checkout);
  } catch (e) {
    if (e instanceof PaymentCancelled) await api("POST", `/v1/p/payments/${checkout.paymentId}/cancel`).catch(() => undefined);
    throw e;
  }
}

/** Server errors the guest can act on get a friendlier message key. */
export const isBusyPaying = (e: unknown) => e instanceof ApiError && e.code === "PAYMENT_IN_PROGRESS";

interface RazorpayCtor {
  new (opts: Record<string, unknown>): { open: () => void };
}

/** Loads Razorpay Checkout on demand (not in the initial bundle) and resolves after server-side verification. */
async function openRazorpay(c: UpiCheckout): Promise<UpiResult> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (!w.Razorpay) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load payment page"));
      document.head.appendChild(s);
    });
  }
  const Razorpay = w.Razorpay;
  if (!Razorpay) throw new Error("Payment page unavailable");
  return new Promise<UpiResult>((resolve, reject) => {
    new Razorpay({
      key: c.keyId,
      order_id: c.gatewayOrderId,
      amount: c.amount,
      currency: c.currency,
      method: { upi: true, card: false, netbanking: false, wallet: false },
      handler: async (r: { razorpay_payment_id: string; razorpay_signature: string }) => {
        try {
          resolve(await api<UpiResult>("POST", `/v1/p/payments/${c.paymentId}/verify`, { gatewayPaymentId: r.razorpay_payment_id, signature: r.razorpay_signature }));
        } catch (e) {
          reject(e);
        }
      },
      modal: { ondismiss: () => reject(new PaymentCancelled("Payment cancelled")) },
    }).open();
  });
}
