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
  // Menu photos are plain <img> tags. With no remote patterns the /_next/image optimizer can't be used
  // as an open proxy to fetch arbitrary (or internal) URLs from the server.
  images: { unoptimized: true, remotePatterns: [] },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
