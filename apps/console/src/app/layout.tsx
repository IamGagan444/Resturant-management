import type { Metadata, Viewport } from "next";
import { Figtree, Inter } from "next/font/google";
import { THEME_SCRIPT } from "@/lib/theme-script";
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
  // Status bar = the header it sits above (TopBar is --surface). These cover the first paint; lib/theme.ts then
  // sets them to the chosen theme (and to the kitchen's forced dark).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#19191c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // THEME_SCRIPT puts .dark / .light on <html> before React loads, so its class differs from the server's on purpose
    <html lang="en" className={`${inter.variable} ${figtree.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
