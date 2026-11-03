import type { FastifyInstance, FastifyReply } from "fastify";
import QRCode from "qrcode";
import { unscopedDb } from "@rms/db";
import {
  LoginInput,
  LoginMfaInput,
  MfaDisableInput,
  MfaEnableInput,
  MfaEnrollFinishInput,
  MfaEnrollStartInput,
  MfaSetupInput,
  type LoginResult,
  type MfaEnabled,
  type MfaSetup,
  type MfaStatus,
} from "@rms/contracts";
import { decrypt, encrypt, hashSecret, randomToken, verifySecret } from "../lib/crypto";
import { AppError, parse, unauthorized } from "../lib/errors";
import { forceSignOut, issueSession, readAccess, revokeAllFor, type AccessClaims } from "../lib/auth";
import { assertHotelOperational, getHotel } from "../lib/hotel";
import {
  LOGIN_MAX_FAILS,
  MFA_CLEARED,
  MFA_MAX_FAILS,
  assertNotLocked,
  burnPending,
  clearFailures,
  consumeSecondFactor,
  failures,
  hashRecoveryCode,
  loadAccount,
  mfaRequired,
  recordFailure,
  signMfaPending,
  updateAccount,
  verifyMfaPending,
  type AccountKind,
  type MfaAccount,
  type PendingMfa,
} from "../lib/mfa";
import { newRecoveryCodes, newTotpSecret, otpauthUrl, verifyTotp } from "../lib/totp";
import { MANAGERS } from "../lib/route";

// Argon2 hash of a random string, made once: verified against when the email is unknown (timing parity).
let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashSecret(randomToken()));

const subjectType = (kind: AccountKind) => (kind === "platform" ? "PLATFORM" : "STAFF");

/** Claims for a session, re-checked from the database (still active, still a manager, restaurant open). */
async function claimsFor(kind: AccountKind, id: string): Promise<AccessClaims> {
  if (kind === "platform") {
    const pu = await unscopedDb.platformUser.findUnique({ where: { id } });
    if (!pu) throw unauthorized();
    return { typ: "platform", sub: pu.id, role: pu.role };
  }
  const s = await unscopedDb.staff.findUnique({ where: { id } });
  if (!s || !s.isActive || !s.passwordHash || !MANAGERS.includes(s.role)) throw unauthorized();
  assertHotelOperational(await getHotel(s.hotelId));
  return { typ: "staff", sub: s.id, hid: s.hotelId, role: s.role, did: null, sid: null };
}

async function openSession(reply: FastifyReply, kind: AccountKind, id: string): Promise<LoginResult> {
  const claims = await claimsFor(kind, id);
  await issueSession(reply, claims);
  return { ok: true, typ: kind };
}

/** New authenticator secret, kept as "pending" until a code from it is entered. */
async function startEnrollment(acct: MfaAccount): Promise<MfaSetup> {
  const secret = newTotpSecret();
  await updateAccount(acct.kind, acct.id, { mfaPendingSecretEnc: encrypt(secret) });
  const url = otpauthUrl(secret, acct.email ?? acct.id);
  return { secret, otpauthUrl: url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 240, errorCorrectionLevel: "M" }) };
}

/**
 * The code proves the phone has the pending secret: it becomes the account's authenticator, with new recovery codes.
 * Every other sign-in of the account ends (they were opened with the old factor, or none).
 */
async function finishEnrollment(acct: MfaAccount, code: string): Promise<string[]> {
  if (!acct.mfaPendingSecretEnc) throw new AppError(409, "MFA_NOT_PENDING", "Start the set-up again");
  const step = verifyTotp(decrypt(acct.mfaPendingSecretEnc), code);
  if (step === null) throw new AppError(400, "BAD_CODE", "That code didn't match. Check the phone's clock and try the newest code.");
  const recoveryCodes = newRecoveryCodes();
  await updateAccount(acct.kind, acct.id, {
    mfaSecretEnc: acct.mfaPendingSecretEnc,
    mfaPendingSecretEnc: null,
    mfaEnabledAt: new Date(),
    mfaLastStep: step,
    mfaRecoveryHashes: recoveryCodes.map(hashRecoveryCode),
  });
  await revokeAllFor(subjectType(acct.kind), acct.id);
  await forceSignOut(acct.id);
  await new Promise((r) => setTimeout(r, 5)); // a session issued next must be newer than the cut-off millisecond
  return recoveryCodes;
}

async function pendingOrThrow(token: string, purpose: "verify" | "enroll"): Promise<PendingMfa> {
  const p = await verifyMfaPending(token, purpose);
  if (!p) throw unauthorized("Sign-in expired. Enter your password again.");
  return p;
}

export async function loginRoutes(app: FastifyInstance) {
  const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  /**
   * Email + password: super admin, or hotel owner/manager on the web admin.
   * The password never opens a session on its own (when MFA is required): the answer is a short-lived `mfaToken`
   * for the code step, or for setting up an authenticator if the account has none yet.
   * Wrong passwords count per account (all IPs together), and unknown emails cost the same time as known ones.
   */
  app.post("/v1/auth/login", strict, async (req, reply): Promise<LoginResult> => {
    const { email, password } = parse(LoginInput, req.body);
    const normalized = email.toLowerCase();
    assertNotLocked(await failures("login", normalized), LOGIN_MAX_FAILS);

    const pu = await unscopedDb.platformUser.findUnique({ where: { email: normalized }, select: { id: true, passwordHash: true } });
    const s = pu ? null : await unscopedDb.staff.findUnique({ where: { email: normalized } });
    const eligible = pu ? true : Boolean(s?.passwordHash && s.isActive && MANAGERS.includes(s.role));
    const hash = pu?.passwordHash ?? (eligible && s?.passwordHash ? s.passwordHash : await dummyHash());
    // same Argon2 cost whether or not the account exists, so response time doesn't reveal valid emails
    const ok = await verifySecret(hash, password);
    if (!eligible || !ok || (!pu && !s)) {
      await recordFailure("login", normalized);
      throw unauthorized("Wrong email or password");
    }
    await clearFailures("login", normalized);

    const kind: AccountKind = pu ? "platform" : "staff";
    const id = pu?.id ?? s?.id ?? "";
    if (s) assertHotelOperational(await getHotel(s.hotelId));
    const acct = await loadAccount(kind, id);
    if (!acct) throw unauthorized("Wrong email or password");
    if (acct.mfaEnabledAt) return { ok: true, typ: kind, mfaRequired: true, mfaToken: await signMfaPending(kind, id, "verify") };
    if (mfaRequired()) return { ok: true, typ: kind, mfaSetupRequired: true, mfaToken: await signMfaPending(kind, id, "enroll") };
    return openSession(reply, kind, id);
  });

  /** Second step: authenticator code (or a one-time recovery code). 5 wrong codes lock the account's second step for 15 min. */
  app.post("/v1/auth/login/mfa", strict, async (req, reply): Promise<LoginResult> => {
    const { mfaToken, code } = parse(LoginMfaInput, req.body);
    const pending = await pendingOrThrow(mfaToken, "verify");
    const who = `${pending.kind}:${pending.id}`;
    assertNotLocked(await failures("mfa", who), MFA_MAX_FAILS);
    const acct = await loadAccount(pending.kind, pending.id);
    if (!acct || !(await consumeSecondFactor(acct, code))) {
      await recordFailure("mfa", who);
      throw unauthorized("Wrong code");
    }
    await clearFailures("mfa", who);
    if (!(await burnPending(pending))) throw unauthorized("Sign-in expired. Enter your password again.");
    return openSession(reply, pending.kind, pending.id);
  });

  // ── First sign-in without an authenticator (MFA required): set it up, then the session opens ──

  /** Password was right moments ago (the enroll token proves it): get a secret / QR to scan. */
  app.post("/v1/auth/mfa/enroll/start", strict, async (req): Promise<MfaSetup> => {
    const { mfaToken } = parse(MfaEnrollStartInput, req.body);
    const pending = await pendingOrThrow(mfaToken, "enroll");
    const acct = await loadAccount(pending.kind, pending.id);
    if (!acct) throw unauthorized();
    if (acct.mfaEnabledAt) throw new AppError(409, "MFA_ALREADY_ON", "Two-step sign-in is already set up. Sign in again.");
    return startEnrollment(acct);
  });

  app.post("/v1/auth/mfa/enroll/finish", strict, async (req, reply): Promise<MfaEnabled & LoginResult> => {
    const { mfaToken, code } = parse(MfaEnrollFinishInput, req.body);
    const pending = await pendingOrThrow(mfaToken, "enroll");
    const who = `${pending.kind}:${pending.id}`;
    assertNotLocked(await failures("mfa", who), MFA_MAX_FAILS);
    const acct = await loadAccount(pending.kind, pending.id);
    if (!acct) throw unauthorized();
    if (acct.mfaEnabledAt) throw new AppError(409, "MFA_ALREADY_ON", "Two-step sign-in is already set up. Sign in again.");
    let recoveryCodes: string[];
    try {
      recoveryCodes = await finishEnrollment(acct, code);
    } catch (e) {
      if (e instanceof AppError && e.code === "BAD_CODE") await recordFailure("mfa", who);
      throw e;
    }
    await clearFailures("mfa", who);
    if (!(await burnPending(pending))) throw unauthorized("Sign-in expired. Enter your password again.");
    const r = await openSession(reply, pending.kind, pending.id);
    return { ...r, ok: true, recoveryCodes };
  });

  // ── Signed in: manage your own authenticator ──
  const subjectOf = (c: AccessClaims): { kind: AccountKind; id: string } => ({ kind: c.typ, id: c.sub });

  app.get("/v1/auth/mfa", async (req): Promise<MfaStatus> => {
    const { kind, id } = subjectOf(await readAccess(req));
    const acct = await loadAccount(kind, id);
    if (!acct) throw unauthorized();
    return {
      enabled: Boolean(acct.mfaEnabledAt),
      required: mfaRequired(),
      available: Boolean(acct.passwordHash),
      recoveryCodesLeft: acct.mfaRecoveryHashes.length,
    };
  });

  /**
   * Set up an authenticator, or move it to a new phone. Needs the password; replacing an active one also needs
   * a current code (or a recovery code), so a stolen session alone can't swap in the thief's phone.
   */
  app.post("/v1/auth/mfa/setup", strict, async (req): Promise<MfaSetup> => {
    const { kind, id } = subjectOf(await readAccess(req));
    const { password, code } = parse(MfaSetupInput, req.body);
    const acct = await loadAccount(kind, id);
    if (!acct?.passwordHash) throw new AppError(400, "NO_PASSWORD_LOGIN", "Two-step sign-in protects email + password sign-in; this account has none");
    const who = `${kind}:${id}`;
    assertNotLocked(await failures("mfa", who), MFA_MAX_FAILS);
    const passwordOk = await verifySecret(acct.passwordHash, password);
    const factorOk = !acct.mfaEnabledAt || (code !== undefined && (await consumeSecondFactor(acct, code)) !== null);
    if (!passwordOk || !factorOk) {
      await recordFailure("mfa", who);
      throw unauthorized(acct.mfaEnabledAt ? "Wrong password or code" : "Wrong password");
    }
    await clearFailures("mfa", who);
    return startEnrollment(acct);
  });

  /** A code from the new authenticator switches to it. Returns new recovery codes (shown once); other sign-ins end. */
  app.post("/v1/auth/mfa/enable", strict, async (req, reply): Promise<MfaEnabled> => {
    const claims = await readAccess(req);
    const { kind, id } = subjectOf(claims);
    const { code } = parse(MfaEnableInput, req.body);
    const acct = await loadAccount(kind, id);
    if (!acct) throw unauthorized();
    const recoveryCodes = await finishEnrollment(acct, code);
    await issueSession(reply, await claimsFor(kind, id)); // this browser stays signed in
    return { ok: true, recoveryCodes };
  });

  /** Only when two-step sign-in is optional (never in production). Needs the password and a current code. */
  app.post("/v1/auth/mfa/disable", strict, async (req) => {
    const { kind, id } = subjectOf(await readAccess(req));
    if (mfaRequired()) throw new AppError(409, "MFA_REQUIRED", "Two-step sign-in is required here. You can move it to a new phone instead.");
    const { password, code } = parse(MfaDisableInput, req.body);
    const acct = await loadAccount(kind, id);
    if (!acct?.mfaEnabledAt || !acct.passwordHash) throw new AppError(409, "MFA_OFF", "Two-step sign-in is not on");
    const who = `${kind}:${id}`;
    assertNotLocked(await failures("mfa", who), MFA_MAX_FAILS);
    if (!(await verifySecret(acct.passwordHash, password)) || !(await consumeSecondFactor(acct, code))) {
      await recordFailure("mfa", who);
      throw unauthorized("Wrong password or code");
    }
    await updateAccount(kind, id, MFA_CLEARED);
    return { ok: true };
  });
}

/** Lost phone and no recovery codes: an admin wipes the authenticator; the next sign-in sets up a new one. */
export async function resetMfa(kind: AccountKind, id: string) {
  await updateAccount(kind, id, MFA_CLEARED);
  await revokeAllFor(subjectType(kind), id);
  await forceSignOut(id);
}
