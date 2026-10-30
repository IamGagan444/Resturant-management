import type { Hotel } from "@rms/db";
import { env } from "../env";
import { decrypt, hmacSha256Hex, randomToken, safeEqual } from "../lib/crypto";

/**
 * Payment gateway behind an interface so Razorpay can be swapped.
 * Each hotel uses its own Razorpay account (hotel is merchant of record).
 */
export interface PaymentGateway {
  readonly name: "razorpay" | "mock";
  readonly keyId: string;
  createOrder(input: { amount: number; currency: string; receipt: string }): Promise<{ gatewayOrderId: string }>;
  /** Signature returned to the browser by Checkout after payment. */
  verifyCheckout(input: { gatewayOrderId: string; gatewayPaymentId: string; signature: string }): boolean;
  verifyWebhook(rawBody: Buffer, signature: string): boolean;
}

class RazorpayGateway implements PaymentGateway {
  readonly name = "razorpay" as const;
  constructor(
    readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  async createOrder(input: { amount: number; currency: string; receipt: string }) {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`,
      },
      body: JSON.stringify({ amount: input.amount, currency: input.currency, receipt: input.receipt.slice(0, 40) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Razorpay order failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { id: string };
    return { gatewayOrderId: body.id };
  }

  verifyCheckout(i: { gatewayOrderId: string; gatewayPaymentId: string; signature: string }) {
    return safeEqual(hmacSha256Hex(this.keySecret, `${i.gatewayOrderId}|${i.gatewayPaymentId}`), i.signature);
  }

  verifyWebhook(rawBody: Buffer, signature: string) {
    return safeEqual(hmacSha256Hex(this.webhookSecret, rawBody), signature);
  }
}

export const MOCK_SECRET = "mock_secret";

/** Local dev / e2e only (PAYMENTS_MOCK=true). Same signature scheme as Razorpay, fixed secret. */
class MockGateway implements PaymentGateway {
  readonly name = "mock" as const;
  readonly keyId = "rzp_test_mock";
  async createOrder() {
    return { gatewayOrderId: `order_mock_${randomToken(9)}` };
  }
  verifyCheckout(i: { gatewayOrderId: string; gatewayPaymentId: string; signature: string }) {
    return safeEqual(hmacSha256Hex(MOCK_SECRET, `${i.gatewayOrderId}|${i.gatewayPaymentId}`), i.signature);
  }
  verifyWebhook(rawBody: Buffer, signature: string) {
    return safeEqual(hmacSha256Hex(MOCK_SECRET, rawBody), signature);
  }
}

export function gatewayFor(hotel: Hotel): PaymentGateway | null {
  if (env.PAYMENTS_MOCK) return new MockGateway();
  if (!hotel.razorpayKeyId || !hotel.razorpayKeySecretEnc || !hotel.razorpayWebhookSecretEnc) return null;
  return new RazorpayGateway(hotel.razorpayKeyId, decrypt(hotel.razorpayKeySecretEnc), decrypt(hotel.razorpayWebhookSecretEnc));
}
