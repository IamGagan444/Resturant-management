import { ApiError, NetworkError } from "./api";

/** One sentence a restaurant owner can act on, for any error the console can hit. */
export function describeError(e: unknown): string {
  if (e instanceof NetworkError) return "No connection. Check the internet and try again.";
  if (e instanceof ApiError) {
    if (e.code === "VALIDATION") return "Some details need fixing. Check the highlighted fields.";
    if (e.status === 401) return e.message && e.message !== "Unauthorized" ? e.message : "Your sign-in ended. Please sign in again.";
    if (e.status === 403 && e.code === "FORBIDDEN") return "You don't have permission to do that.";
    if (e.status === 413) return "That file is too large.";
    if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
    if (e.status >= 500) return "Something went wrong on our side. Please try again.";
    return e.message;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong. Please try again.";
}

/** Field → first message, from a VALIDATION error's details (zod flatten()). */
export function fieldErrorsOf(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.code !== "VALIDATION") return {};
  const d = e.details as { fieldErrors?: Record<string, string[] | undefined> } | undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(d?.fieldErrors ?? {})) if (v?.[0]) out[k] = v[0];
  return out;
}
