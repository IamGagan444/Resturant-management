import path from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

config({ path: path.resolve(process.cwd(), "../../.env") });

/**
 * Static export: the console is a client-only app. A static build is trivially cacheable by a
 * service worker (offline, Phase 3) and can be served from the local hub on restaurant Wi-Fi.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next", // e2e runs beside a dev server without sharing its build folder
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@rms/contracts", "@rms/domain"],
  env: { NEXT_PUBLIC_API_URL: process.env.API_URL ?? "http://localhost:4000" },
  eslint: { ignoreDuringBuilds: true }, // lint runs once at the repo root (pnpm lint)
  images: { unoptimized: true },
};

export default nextConfig;
