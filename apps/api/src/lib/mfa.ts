import { createHmac, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { unscopedDb } from "@rms/db";
import { env } from "../env";
import { redis } from "../jobs/queue";
import { decrypt, sha256 } from "./crypto";
import { AppError } from "./errors";
import { normalizeRecoveryCode, verifyTotp } from "./totp";

/**
 * Two-step sign-in for password accounts (platform admins, owners, managers) and brute-force limits.
 * PIN sign-in on a paired device is already two factors (the paired device + the PIN), so it is not affected.
 *
 * With MFA_REQUIRED (default, and mandatory in production) a password alone never opens a session:
 * accounts without an authenticator are walked through enrolling it right at sign-in.
 */

export type AccountKind = "platform" | "staff";

export const mfaRequired = () => env.MFA_REQUIRED;

export interface MfaAccount {
  id: string;
  kind: AccountKind;
  email: string | null;
  passwordHash: string | null;
  mfaSecretEnc: string | null;
  mfaPendingSecretEnc: string | null;
  mfaEnabledAt: Date | null;
  mfaLastStep: number | null;
  mfaRecoveryHashes: string[];
}

const mfaSelect = {
  id: true,
  email: true,
  passwordHash: true,
  mfaSecretEnc: true,
  mfaPendingSecretEnc: true,
  mfaEnabledAt: true,
  mfaLastStep: true,
  mfaRecoveryHashes: true,
} as const;

export async function loadAccount(kind: AccountKind, id: string): Promise<MfaAccount | null> {
  const row =
    kind === "platform"
      ? await unscopedDb.platformUser.findUnique({ where: { id }, select: mfaSelect })
      : await unscopedDb.staff.findUnique({ where: { id }, select: mfaSelect });
  return row ? { ...row, kind } : null;
}

type MfaData = Partial<Pick<MfaAccount, "mfaSecretEnc" | "mfaPendingSecretEnc" | "mfaEnabledAt" | "mfaLastStep" | "mfaRecoveryHashes">>;

export async function updateAccount(kind: AccountKind, id: string, data: MfaData) {
  if (kind === "platform") await unscopedDb.platformUser.update({ where: { id }, data });
  else await unscopedDb.staff.update({ where: { id }, data });
}

/** Everything about the second factor wiped: the next sign-in enrolls a new authenticator. */
export const MFA_CLEARED: MfaData = { mfaSecretEnc: null, mfaPendingSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] };

/**
 * Accept a TOTP code once (replay-proof: the step must be newer than the last accepted one, set atomically)
 * or burn a recovery code. Returns how it was accepted, or null.
 */
export async function consumeSecondFactor(acct: MfaAccount, code: string): Promise<"totp" | "recovery" | null> {
  if (!acct.mfaSecretEnc || !acct.mfaEnabledAt) return null;
  const trimmed = code.trim();
  if (/^\d{6}$/.test(trimmed)) {
    const step = verifyTotp(decrypt(acct.mfaSecretEnc), trimmed);
    if (step === null) return null;
    const where = { id: acct.id, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] };
    const r =
      acct.kind === "platform"
        ? await unscopedDb.platformUser.updateMany({ where, data: { mfaLastStep: step } })
        : await unscopedDb.staff.updateMany({ where, data: { mfaLastStep: step } });
    return r.count === 1 ? "totp" : null;
  }
  const hash = hashRecoveryCode(trimmed);
  if (!acct.mfaRecoveryHashes.includes(hash)) return null;
  const remaining = acct.mfaRecoveryHashes.filter((h) => h !== hash);
  // only succeeds if nobody used the same code in between
  const where = { id: acct.id, mfaRecoveryHashes: { has: hash } };
  const r =
    acct.kind === "platform"
      ? await unscopedDb.platformUser.updateMany({ where, data: { mfaRecoveryHashes: remaining } })
      : await unscopedDb.staff.updateMany({ where, data: { mfaRecoveryHashes: remaining } });
  return r.count === 1 ? "recovery" : null;
}

export const hashRecoveryCode = (code: string) => sha256(`recovery:${normalizeRecoveryCode(code)}`);

// ── Pending second step ────────────────────────
// After the password is right, the browser holds this short-lived token until the code is entered
// ("verify") or the authenticator is set up ("enroll"). Own key and `typ`: never usable as an access token.
// Single use: the token's id is burnt when it opens a session.
export type PendingPurpose = "verify" | "enroll";
const PENDING_TTL_SEC = 5 * 60;
const pendingKey = new TextEncoder().encode(createHmac("sha256", env.JWT_ACCESS_SECRET).update("mfa-pending").digest("base64url"));

export async function signMfaPending(kind: AccountKind, id: string, purpose: PendingPurpose): Promise<string> {
  return new SignJWT({ typ: "mfa", knd: kind, pur: purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${PENDING_TTL_SEC}s`)
    .sign(pendingKey);
}

export interface PendingMfa {
  kind: AccountKind;
  id: string;
  jti: string;
}

export async function verifyMfaPending(token: string, purpose: PendingPurpose): Promise<PendingMfa | null> {
  try {
    const { payload } = await jwtVerify(token, pendingKey, { algorithms: ["HS256"] });
    if (payload.typ !== "mfa" || payload.pur !== purpose || (payload.knd !== "platform" && payload.knd !== "staff") || !payload.sub || !payload.jti) return null;
    return { kind: payload.knd, id: payload.sub, jti: payload.jti };
  } catch {
    return null;
  }
}

/** Mark a pending token used. False if it already was (a replayed token must not open a second session). */
export async function burnPending(p: PendingMfa): Promise<boolean> {
  const UNAVAILABLE = Symbol("redis-unavailable");
  const r = await Promise.race([
    redis.set(`auth:mfa-used:${p.jti}`, "1", "EX", PENDING_TTL_SEC + 60, "NX").catch(() => UNAVAILABLE),
    new Promise<typeof UNAVAILABLE>((res) => setTimeout(() => res(UNAVAILABLE), 300)),
  ]);
  if (r === UNAVAILABLE) return true; // Redis down: fail open — the code / recovery code itself was single-use
  return r === "OK"; // null: NX refused, the token was already used
}

// ── Failure counters (per account, across all IPs) ─────────────
// The per-IP rate limit alone lets a botnet try one password per IP. These cap guesses per account.
const WINDOW_SEC = 15 * 60;
export const LOGIN_MAX_FAILS = 10;
export const MFA_MAX_FAILS = 5;
/** Wrong table join codes per live session: 4 digits must not be guessable by trying them all. */
export const JOIN_MAX_FAILS = 20;

export type FailScope = "login" | "mfa" | "join";
const failKey = (scope: string, who: string) => `auth:fail:${scope}:${sha256(who.toLowerCase())}`;

/**
 * Redis trouble must not lock everyone out or hang sign-in (the client queues commands while disconnected):
 * counters give up after a moment and fail open. The per-IP rate limit still applies.
 */
function soon<T>(p: Promise<T>): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 300))]);
}

export async function failures(scope: FailScope, who: string): Promise<number> {
  const v = await soon(redis.get(failKey(scope, who)));
  return v ? Number(v) : 0;
}

export async function recordFailure(scope: FailScope, who: string): Promise<void> {
  const k = failKey(scope, who);
  await soon(redis.multi().incr(k).expire(k, WINDOW_SEC, "NX").exec());
}

export async function clearFailures(scope: FailScope, who: string): Promise<void> {
  await soon(redis.del(failKey(scope, who)));
}

export function assertNotLocked(count: number, max: number) {
  if (count >= max) throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many wrong attempts. Wait 15 minutes and try again.");
}
