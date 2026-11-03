import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../env";
import { COOKIE } from "./auth";
import { forbidden } from "./errors";

/**
 * HTTP-level protections shared by every route.
 *
 *  - CSRF: auth cookies are SameSite=Lax, which already stops cross-site POSTs. But the guest app, console and
 *    API are sibling subdomains of one site, and "same-site" requests from any subdomain still carry Lax cookies.
 *    So a state-changing request that carries one of our cookies must also come from one of our own origins.
 *    Requests without an Origin header (server-to-server: hub, Razorpay webhooks, curl) carry no ambient browser
 *    credentials worth forging and are left alone; they authenticate with a bearer token or a signature.
 *  - Security headers on every API response.
 *  - Capability tokens in URLs (receipt links, table QR tokens) are redacted from request logs.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const AUTH_COOKIES = Object.values(COOKIE) as string[];

export function allowedOrigins(): Set<string> {
  return new Set([env.CUSTOMER_URL, env.CONSOLE_URL, env.API_URL].map((u) => new URL(u).origin));
}

function originOf(req: FastifyRequest): string | null {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin !== "null") return origin;
  if (origin === "null") return "null"; // sandboxed iframe / file:// — never one of ours
  const referer = req.headers.referer;
  if (typeof referer === "string") {
    try {
      return new URL(referer).origin;
    } catch {
      return "null";
    }
  }
  return null;
}

/** Exported for tests. */
export function isCsrfSuspect(req: FastifyRequest, origins: Set<string>): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const cookies = req.cookies ?? {};
  if (!AUTH_COOKIES.some((name) => cookies[name])) return false; // nothing ambient to abuse
  const origin = originOf(req);
  if (origin === null) return false; // non-browser client
  return !origins.has(origin);
}

/** Redact secrets that live in URL paths / query strings before they reach logs. */
export function redactUrl(url: string): string {
  return url
    .replace(/^\/v1\/r\/[^/?#]+/, "/v1/r/[redacted]")
    .replace(/^\/v1\/p\/t\/[^/?#]+/, "/v1/p/t/[redacted]")
    .replace(/([?&](?:deviceId|token|code)=)[^&#]*/gi, "$1[redacted]");
}

export async function registerSecurity(app: FastifyInstance) {
  const origins = allowedOrigins();

  app.addHook("onRequest", async (req) => {
    if (isCsrfSuspect(req, origins)) throw forbidden("Cross-origin request refused");
  });

  app.addHook("onSend", async (_req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("cross-origin-resource-policy", "cross-origin"); // menu photos are embedded by the guest app
    // JSON and images need nothing; the inline QR-sheet PDF is left to the browser's own viewer
    if (!String(reply.getHeader("content-type") ?? "").startsWith("application/pdf")) {
      reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    }
    if (env.COOKIE_SECURE) reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    reply.removeHeader("x-powered-by");
    return payload;
  });
}
