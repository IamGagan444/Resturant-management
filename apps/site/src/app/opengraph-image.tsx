import { ImageResponse } from "next/og";
import { SITE } from "@/site";

// The preview card shown when the link is shared on WhatsApp, LinkedIn, X, Slack… Rendered once at build time.
export const dynamic = "force-static";
export const alt = `${SITE.name}: QR ordering, kitchen display and billing for restaurants`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#f7f6f3",
          color: "#1c2430",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: "#bd421c", display: "flex" }} />
          <div style={{ fontSize: 44, fontWeight: 800 }}>{SITE.name}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.08, letterSpacing: -2 }}>
            Scan. Order. Cook. Pay.
          </div>
          <div style={{ fontSize: 34, color: "#5f6670", lineHeight: 1.3 }}>
            QR table ordering, kitchen display, UPI payments and GST billing for restaurants in India.
          </div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {["No app for guests", "Works offline", "UPI + split bills"].map((t) => (
            <div
              key={t}
              style={{ fontSize: 24, padding: "10px 22px", borderRadius: 999, background: "#fbe9e2", color: "#bd421c", fontWeight: 700 }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
