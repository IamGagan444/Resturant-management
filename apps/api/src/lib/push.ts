import { createECDH, createHmac } from "node:crypto";
import webpush from "web-push";
import type { PushPayload } from "@rms/contracts";
import { env } from "../env";

/**
 * Web Push (VAPID). The key pair is derived from ENCRYPTION_KEY, so there is nothing extra to configure and every
 * API instance agrees on it. Changing ENCRYPTION_KEY changes the pair; browsers re-subscribe when they next open the app.
 */
function vapid() {
  const ecdh = createECDH("prime256v1");
  // a hash is a valid P-256 private key with overwhelming probability; the counter covers the rest
  for (let i = 0; ; i++) {
    const d = createHmac("sha256", env.ENCRYPTION_KEY).update(`vapid:${i}`).digest();
    try {
      ecdh.setPrivateKey(d);
      return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: d.toString("base64url") };
    } catch {
      continue;
    }
  }
}
const keys = vapid();
export const pushPublicKey = keys.publicKey;

const details = { subject: env.CONSOLE_URL.startsWith("https://") ? env.CONSOLE_URL : "mailto:alerts@example.com", ...keys };

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export type PushResult = "SENT" | "GONE" | "FAILED";

/** Swapped out by tests. */
export const pushTransport = {
  async send(t: PushTarget, payload: PushPayload): Promise<PushResult> {
    try {
      await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, JSON.stringify(payload), {
        vapidDetails: details,
        // high: wakes a dozing phone now. Short TTL + one topic: a phone that was off isn't flooded with old rings.
        urgency: "high",
        TTL: 60,
        topic: "alerts",
        timeout: 10_000,
      });
      return "SENT";
    } catch (e) {
      const status = e instanceof webpush.WebPushError ? e.statusCode : 0;
      return status === 404 || status === 410 ? "GONE" : "FAILED";
    }
  },
};
