import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Single .env at the repo root; Prisma CLI runs with cwd = packages/db.
config({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/seed.ts",
  },
});
