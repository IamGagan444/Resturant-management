import type { NextConfig } from "next";

/**
 * Marketing site: a fully static export (out/), served by Caddy at SITE_HOST. Every page is plain HTML at build
 * time, which is what search engines index best, and it needs no server or API.
 * NEXT_PUBLIC_SITE_URL (the canonical address, e.g. https://kotsync.com) is baked in at build time.
 */
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "export",
  trailingSlash: false,
  eslint: { ignoreDuringBuilds: true }, // lint runs once at the repo root (pnpm lint)
  images: { unoptimized: true },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
};

export default nextConfig;
