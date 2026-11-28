import { ImageResponse } from "next/og";

// iOS home-screen / bookmark icon (PNG; iOS ignores SVG icons).
export const dynamic = "force-static";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#bd421c",
          color: "#ffffff",
          fontSize: 76,
          fontWeight: 800,
          fontFamily: "sans-serif",
          letterSpacing: -3,
        }}
      >
        KOT
      </div>
    ),
    size,
  );
}
