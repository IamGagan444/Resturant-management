"use client";

import type { DeviceJwk } from "@rms/contracts";

/**
 * This browser's own signing key for the local hub (ECDSA P-256).
 *
 * The private key is created non-extractable and kept in IndexedDB as a CryptoKey object: scripts on the page can
 * ask the browser to sign with it, but can never read it out. Hub passes are bound to this key, and each hub request
 * carries a fresh signed proof — so a pass copied out of localStorage is worthless anywhere else.
 */

const DB = "rms-keys";
const STORE = "keys";
const ID = "hub-device-key";

interface Stored {
  privateKey: CryptoKey;
  jwk: DeviceJwk;
}

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

let cached: Promise<Stored> | null = null;

export function deviceKey(): Promise<Stored> {
  cached ??= (async () => {
    const existing = await idb<Stored | undefined>("readonly", (s) => s.get(ID) as IDBRequest<Stored | undefined>).catch(() => undefined);
    if (existing?.privateKey && existing.jwk) return existing;
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])) as CryptoKeyPair;
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const stored: Stored = { privateKey: pair.privateKey, jwk: { kty: "EC", crv: "P-256", x: pub.x ?? "", y: pub.y ?? "" } };
    await idb("readwrite", (s) => s.put(stored, ID));
    return stored;
  })().catch((e: unknown) => {
    cached = null;
    throw e;
  });
  return cached;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (o: object) => b64url(new TextEncoder().encode(JSON.stringify(o)));

/** Proof for one hub request: signed by the device key, for this method + URL, now, once. */
export async function proofFor(method: string, url: string): Promise<string> {
  const { privateKey, jwk } = await deviceKey();
  const u = new URL(url);
  const head = enc({ typ: "dpop+jwt", alg: "ES256", jwk });
  const body = enc({ htm: method.toUpperCase(), htu: `${u.origin}${u.pathname}`, iat: Math.floor(Date.now() / 1000), jti: crypto.randomUUID() });
  // WebCrypto's ECDSA signature is raw r‖s (64 bytes) — exactly the JWS ES256 format
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
