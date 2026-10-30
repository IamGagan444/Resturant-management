import { API_URL, getMode, reportUnreachable, target } from "./net";

export { API_URL };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** The server couldn't be reached at all (no internet, hub off). Distinct from the server saying no. */
export class NetworkError extends ApiError {
  constructor() {
    super(0, "NETWORK", "No connection. Your work is saved and will sync.");
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time; concurrent 401s wait for the same rotation. */
function refresh(): Promise<boolean> {
  refreshing ??= fetch(`${API_URL}/v1/auth/refresh`, { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * Call the API. Goes to the cloud normally, or to the restaurant's local hub during an outage (see net.ts).
 * Cloud access-token expiry is handled transparently.
 */
export async function api<T>(method: Method, path: string, body?: unknown, retried = false): Promise<T> {
  const isForm = body instanceof FormData;
  const t = target();
  let res: Response;
  try {
    res = await fetch(`${t.base}${path}`, {
      method,
      credentials: t.credentials,
      headers: { ...t.headers, ...(body === undefined || isForm ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    reportUnreachable();
    throw new NetworkError();
  }
  if (res.status === 401 && !retried && getMode() === "cloud" && !path.startsWith("/v1/auth/")) {
    if (await refresh()) return api<T>(method, path, body, true);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } };
  if (!res.ok) throw new ApiError(res.status, json.error?.code ?? "UNKNOWN", json.error?.message ?? "Request failed", json.error?.details);
  return json as T;
}

export const newClientId = () => crypto.randomUUID();

/**
 * Time-ordered UUID (v7) for ids this device creates that the server keeps, e.g. order lines:
 * they sort in the order they were made, so tickets list dishes as the waiter entered them.
 */
let lastMs = 0;
let seq = 0;
export function newOrderedId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const now = Date.now();
  seq = now === lastMs ? seq + 1 : 0; // ids made in the same millisecond still sort in order
  lastMs = now;
  let ms = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = ms & 0xff;
    ms = Math.floor(ms / 256);
  }
  b[6] = 0x70 | ((seq >> 8) & 0x0f); // version 7 + counter high bits
  b[7] = seq & 0xff;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80; // variant
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const rupees = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);

/** ₹ string from a form field → paise. */
export const toPaise = (rupeeText: string) => Math.round(Number(rupeeText || 0) * 100);

/**
 * Query function that remembers its last good answer on this device. With no connection it returns that
 * instead of an error, so a kitchen screen reloaded during an outage still shows its tickets.
 */
export async function remembered<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = `rms.cache.${key}`;
  try {
    const v = await fn();
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // quota / private mode: fine, just no offline copy
    }
    return v;
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(k);
    if (saved) return JSON.parse(saved) as T;
    throw e;
  }
}
