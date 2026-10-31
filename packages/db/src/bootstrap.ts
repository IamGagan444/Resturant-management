import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import { hash } from "@node-rs/argon2";
import { PrismaClient } from "@prisma/client";

/**
 * Production setup: the super admin and the subscription plans. No demo data.
 * Safe to run on every deploy. The admin's password is only changed with ADMIN_RESET_PASSWORD=true.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long passphrase' pnpm db:bootstrap
 */
export async function ensurePlatform(prisma: PrismaClient, admin: { email: string; password: string; resetPassword?: boolean }) {
  const passwordHash = await hash(admin.password);
  await prisma.platformUser.upsert({
    where: { email: admin.email },
    update: admin.resetPassword ? { passwordHash } : {},
    create: { email: admin.email, name: "Platform Admin", passwordHash, role: "SUPER_ADMIN" },
  });

  const starter = await prisma.plan.upsert({
    where: { name: "Starter" },
    update: {},
    create: {
      name: "Starter",
      priceMonthly: 99900,
      maxTables: 15,
      maxStaff: 10,
      features: { kds: true, offlineMode: false, inventory: false, roomService: false },
    },
  });
  const pro = await prisma.plan.upsert({
    where: { name: "Pro" },
    update: {},
    create: {
      name: "Pro",
      priceMonthly: 249900,
      maxTables: 60,
      maxStaff: 50,
      features: { kds: true, offlineMode: true, inventory: false, roomService: true },
    },
  });
  return { starter, pro };
}

async function main() {
  config({ path: "../../.env" });
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD");
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  const prisma = new PrismaClient();
  try {
    await ensurePlatform(prisma, { email, password, resetPassword: process.env.ADMIN_RESET_PASSWORD === "true" });
    console.log(`Super admin ready: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
