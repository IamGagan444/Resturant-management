import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

// Single .env at the repo root. Existing process env (tests, prod) wins.
config({ path: path.resolve(import.meta.dirname, "../../../.env") });

const blank = (v: unknown) => (v === "" ? undefined : v);

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET too short"),
  JWT_REFRESH_SECRET: z.string().min(32, "JWT_REFRESH_SECRET too short"),
  ENCRYPTION_KEY: z.string().min(32, "ENCRYPTION_KEY too short"),
  API_URL: z.string().url().default("http://localhost:4000"),
  CUSTOMER_URL: z.string().url().default("http://localhost:3000"),
  CONSOLE_URL: z.string().url().default("http://localhost:3001"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  UPLOAD_DIR: z.string().default("./uploads"),
  // S3 / R2 (STORAGE_DRIVER=s3). S3_ENDPOINT only for non-AWS (R2, MinIO). Empty strings count as unset.
  S3_ENDPOINT: z.preprocess(blank, z.string().url().optional()),
  S3_REGION: z.preprocess(blank, z.string().optional()),
  S3_BUCKET: z.preprocess(blank, z.string().optional()),
  S3_ACCESS_KEY: z.preprocess(blank, z.string().optional()),
  S3_SECRET_KEY: z.preprocess(blank, z.string().optional()),
  S3_PUBLIC_URL: z.preprocess(blank, z.string().url().optional()),
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
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment:", parsed.error.flatten().fieldErrors);
  throw new Error("Invalid environment");
}
if (parsed.data.STORAGE_DRIVER === "s3") {
  const missing = (["S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_PUBLIC_URL"] as const).filter((k) => !parsed.data[k]);
  if (missing.length) throw new Error(`STORAGE_DRIVER=s3 needs ${missing.join(", ")}`);
}
if (parsed.data.NODE_ENV === "production" && parsed.data.PAYMENTS_MOCK) {
  throw new Error("PAYMENTS_MOCK must not be enabled in production");
}

export const env = parsed.data;
