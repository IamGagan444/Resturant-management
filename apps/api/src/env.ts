import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

// Single .env at the repo root. Existing process env (tests, prod) wins.
config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const blank = (v: unknown) => (v === "" ? undefined : v);

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  /** Tenant pool, role rms_app (row-level security applies). */
  DATABASE_URL: z.url(),
  /** Unscoped pool, role rms_platform. Required in production; locally it may be left out (then = DATABASE_URL). */
  DATABASE_PLATFORM_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
  REDIS_URL: z.url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET too short"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET too short"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY too short"),
  API_URL: z.url().default("http://localhost:4000"),
  CUSTOMER_URL: z.url().default("http://localhost:3000"),
  CONSOLE_URL: z.url().default("http://localhost:3001"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("./uploads"),
  // S3 / R2 (STORAGE_DRIVER=s3). S3_ENDPOINT only for non-AWS (R2, MinIO). Empty strings count as unset.
  S3_ENDPOINT: z.preprocess(blank, z.url().optional()),
  S3_REGION: z.preprocess(blank, z.string().optional()),
  S3_BUCKET: z.preprocess(blank, z.string().optional()),
  S3_ACCESS_KEY: z.preprocess(blank, z.string().optional()),
  S3_SECRET_KEY: z.preprocess(blank, z.string().optional()),
  S3_PUBLIC_URL: z.preprocess(blank, z.url().optional()),
  /** Fake UPI gateway for local dev / e2e. Never enable in production. */
  PAYMENTS_MOCK: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Run BullMQ workers inside the API process (default on; set false when running a separate worker). */
  RUN_WORKER: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  /**
   * Which proxies may set X-Forwarded-For (client IP for rate limits and session lists). Default: only proxies on
   * loopback / private networks, e.g. Caddy in docker compose. Addresses/CIDRs, comma separated, or "false".
   * Never "true": then any client could pick its own IP.
   */
  TRUST_PROXY: z
    .string()
    .default("loopback, linklocal, uniquelocal")
    .refine((v) => v !== "true", "TRUST_PROXY=true trusts spoofed X-Forwarded-For; list proxy addresses instead")
    .transform((v): string | boolean => (v === "false" ? false : v)),
  /** Password sign-in needs an authenticator code too (enrolled at first sign-in). Mandatory in production. */
  MFA_REQUIRED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", z.flattenError(parsed.error).fieldErrors);
  throw new Error("Invalid environment");
}
if (parsed.data.STORAGE_DRIVER === "s3") {
  const missing = (["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_PUBLIC_URL"] as const).filter((k) => !parsed.data[k]);
  if (missing.length) throw new Error(`STORAGE_DRIVER=s3 needs ${missing.join(", ")}`);
}
if (parsed.data.NODE_ENV === "production" && parsed.data.PAYMENTS_MOCK) {
  throw new Error("PAYMENTS_MOCK must not be enabled in production");
}
if (parsed.data.NODE_ENV === "production" && !parsed.data.COOKIE_SECURE) {
  throw new Error("COOKIE_SECURE must be true in production (auth cookies would travel over plain HTTP)");
}
if (parsed.data.NODE_ENV === "production" && !parsed.data.MFA_REQUIRED) {
  throw new Error("MFA_REQUIRED must be true in production (password-only sign-in to the admin is not allowed)");
}
if (parsed.data.NODE_ENV === "production" && (!parsed.data.DATABASE_PLATFORM_URL || parsed.data.DATABASE_PLATFORM_URL === parsed.data.DATABASE_URL)) {
  throw new Error("Production needs DATABASE_URL (role rms_app) and a different DATABASE_PLATFORM_URL (role rms_platform)");
}
if (parsed.data.JWT_ACCESS_SECRET === parsed.data.JWT_REFRESH_SECRET) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ (guest tokens must never verify as staff tokens)");
}

export const env = parsed.data;
