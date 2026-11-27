import type { Metadata, Viewport } from "next";
import { Figtree, Inter } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap", weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: { default: "Restro", template: "%s · Restro" },
  description: "Restaurant management: QR ordering, kitchen screens, billing and reports.",
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // paint edge to edge; headers and bars pad themselves with env(safe-area-inset-*)
  interactiveWidget: "resizes-content", // Android keyboard shrinks the layout, so sheets and pinned inputs stay visible
  // Status bar = the header it sits above (TopBar is --surface). The kitchen screen swaps it for dark (kds/page.tsx).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#17202a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${figtree.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
