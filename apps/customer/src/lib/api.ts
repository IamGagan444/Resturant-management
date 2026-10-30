/** Error carrying the API's machine-readable code (JOIN_CODE_REQUIRED, ITEM_UNAVAILABLE, …). */
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

/** Same-origin call through the Next rewrite, so the httpOnly guest cookie just works. */
export async function api<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details?: unknown } };
  if (!res.ok) {
    throw new ApiError(res.status, json.error?.code ?? "UNKNOWN", json.error?.message ?? "Something went wrong", json.error?.details);
  }
  return json as T;
}

/** Stable random id per browser; identifies this phone within a table session. */
export function deviceId(): string {
  const k = "rms.deviceId";
  try {
    const existing = localStorage.getItem(k);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(k, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

export const newClientId = () => crypto.randomUUID();
