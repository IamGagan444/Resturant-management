import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";

/**
 * Demo / e2e only. The seeded demo owner (public password in the README) has this authenticator secret,
 * so end-to-end tests sign in through the real two-step flow. The seed refuses to run in production.
 */
export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 code (SHA-1, 6 digits, 30 s) for a time step. */
export function totpCode(secretB32: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const o = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin = (((mac[o] ?? 0) & 0x7f) << 24) | ((mac[o + 1] ?? 0) << 16) | ((mac[o + 2] ?? 0) << 8) | (mac[o + 3] ?? 0);
  return String(bin % 1_000_000).padStart(6, "0");
}

export const totpStep = (now = Date.now()) => Math.floor(now / 30_000);

/** Same at-rest format as the API (AES-256-GCM, key = SHA-256 of ENCRYPTION_KEY): iv.tag.ciphertext. */
export function encryptAtRest(plain: string, encryptionKey: string): string {
  const key = createHash("sha256").update(encryptionKey).digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}
