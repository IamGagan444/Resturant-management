import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./crypto";

/**
 * TOTP (RFC 6238: HMAC-SHA1, 6 digits, 30 s) — what Google Authenticator, Microsoft Authenticator,
 * 1Password and Authy expect from an otpauth:// link.
 */

const STEP_SEC = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, base32 (the form authenticator apps take). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SEC);

export function hotp(secretB32: string, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const bin = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Check a code against the current step ±1 (clock drift). Returns the matching step, or null.
 * Callers must reject steps <= the last accepted one, so a code can't be used twice.
 */
export function verifyTotp(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  let match: number | null = null;
  // check every window (no early exit) so timing doesn't reveal which one matched
  for (const s of [step - 1, step, step + 1]) {
    if (safeEqual(hotp(secretB32, s), code) && match === null) match = s;
  }
  return match;
}

export function otpauthUrl(secretB32: string, account: string, issuer = "Restro"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}

/** 10 one-time recovery codes like "k7f2-9qxm-3hdp" (60 bits each). */
export function newRecoveryCodes(n = 10): string[] {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(12);
    const chars = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
  });
}

export const normalizeRecoveryCode = (c: string) => c.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
