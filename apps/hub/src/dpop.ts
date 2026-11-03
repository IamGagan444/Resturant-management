import { calculateJwkThumbprint, decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";
import { DeviceJwk } from "@rms/contracts";

/**
 * Proof of possession for hub passes (RFC 9449 "DPoP" style).
 *
 * Every request to the hub carries, next to the pass, a short JWT signed by the device's own ECDSA key:
 *   header { typ: "dpop+jwt", alg: "ES256", jwk }   payload { htm, htu, iat, jti }
 * The hub checks the key is the one the pass was issued to (thumbprint = pass `cnf.jkt`), that the proof is for
 * this method and path, recent, and never seen before. The private key is non-extractable in the browser,
 * so a pass copied out of storage (e.g. by an XSS) can't be used from another machine.
 */

const MAX_AGE_SEC = 300; // devices and the hub box may disagree on the time by a few minutes
const seen = new Map<string, number>(); // jti → expiry (ms)

function remember(jti: string): boolean {
  const now = Date.now();
  if (seen.size > 5000) for (const [k, exp] of seen) if (exp < now) seen.delete(k);
  if (seen.has(jti)) return false;
  seen.set(jti, now + 2 * MAX_AGE_SEC * 1000);
  return true;
}

const pathOf = (url: string) => {
  try {
    return new URL(url, "http://hub.invalid").pathname;
  } catch {
    return null;
  }
};

/** Throws unless `proof` is a fresh, single-use proof for `method` + `path` by the key with thumbprint `jkt`. */
export async function verifyProof(proof: string | undefined, jkt: string, method: string, path: string): Promise<void> {
  if (!proof) throw new Error("missing proof");
  const header = decodeProtectedHeader(proof);
  if (header.typ !== "dpop+jwt" || header.alg !== "ES256") throw new Error("bad proof header");
  const jwk = DeviceJwk.parse(header.jwk);
  if ((await calculateJwkThumbprint(jwk as JWK, "sha256")) !== jkt) throw new Error("proof key is not the pass's key");
  const { payload } = await jwtVerify(proof, await importJWK(jwk as JWK, "ES256"), {
    typ: "dpop+jwt",
    algorithms: ["ES256"],
    maxTokenAge: `${MAX_AGE_SEC}s`,
    clockTolerance: MAX_AGE_SEC,
  });
  if (typeof payload.htm !== "string" || payload.htm.toUpperCase() !== method.toUpperCase()) throw new Error("proof is for another method");
  if (typeof payload.htu !== "string" || pathOf(payload.htu) !== pathOf(path)) throw new Error("proof is for another URL");
  if (typeof payload.jti !== "string" || payload.jti.length < 16 || !remember(payload.jti)) throw new Error("proof replayed");
}
