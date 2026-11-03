import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

/**
 * Turn on the two application database roles created by the RLS migration and set their passwords.
 * Runs as the database owner (DATABASE_ADMIN_URL) after `migrate deploy`; safe to run on every deploy.
 *
 *   DATABASE_ADMIN_URL=... RMS_APP_DB_PASSWORD=... RMS_PLATFORM_DB_PASSWORD=... pnpm db:provision
 *
 * The API then connects as   DATABASE_URL           = postgresql://rms_app:<RMS_APP_DB_PASSWORD>@host/db
 *                            DATABASE_PLATFORM_URL  = postgresql://rms_platform:<RMS_PLATFORM_DB_PASSWORD>@host/db
 */
export async function provisionRoles(admin: PrismaClient, passwords: { app: string; platform: string }) {
  for (const [role, password] of [
    ["rms_app", passwords.app],
    ["rms_platform", passwords.platform],
  ] as const) {
    if (password.length < 16) throw new Error(`${role} password must be at least 16 characters`);
    // DDL can't take bind parameters: let Postgres quote the literal itself (format %L), never string-concatenate
    const [row] = await admin.$queryRaw<{ q: string }[]>`SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', ${role}::text, ${password}::text) AS q`;
    if (!row) throw new Error("format() returned nothing");
    await admin.$executeRawUnsafe(row.q);
  }
  const [db] = await admin.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (db) {
    const [grant] = await admin.$queryRaw<{ q: string }[]>`SELECT format('GRANT CONNECT ON DATABASE %I TO rms_app, rms_platform', ${db.name}::text) AS q`;
    if (grant) await admin.$executeRawUnsafe(grant.q);
  }
}

async function main() {
  config({ path: "../../.env" });
  const url = process.env.DATABASE_ADMIN_URL;
  const app = process.env.RMS_APP_DB_PASSWORD;
  const platform = process.env.RMS_PLATFORM_DB_PASSWORD;
  if (!url || !app || !platform) throw new Error("Set DATABASE_ADMIN_URL, RMS_APP_DB_PASSWORD and RMS_PLATFORM_DB_PASSWORD");
  if (app === platform) throw new Error("Use different passwords for rms_app and rms_platform");
  const admin = new PrismaClient({ datasourceUrl: url });
  try {
    await provisionRoles(admin, { app, platform });
    console.log("Database roles rms_app and rms_platform are ready");
  } finally {
    await admin.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
