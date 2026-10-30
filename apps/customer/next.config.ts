import path from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// next runs with cwd = apps/customer
config({ path: path.resolve(process.cwd(), "../../.env") });

const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next", // e2e runs beside a dev server without sharing its build folder
  transpilePackages: ["@rms/contracts", "@rms/domain"],
  eslint: { ignoreDuringBuilds: true }, // lint runs once at the repo root (pnpm lint)
  env: { NEXT_PUBLIC_API_URL: API_URL },
  // Same-origin REST: the guest cookie is first-party and no CORS preflight on slow networks.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${API_URL}/v1/:path*` }];
  },
  images: { remotePatterns: [{ protocol: "http", hostname: "localhost" }, { protocol: "https", hostname: "**" }] },
};

export default nextConfig;
