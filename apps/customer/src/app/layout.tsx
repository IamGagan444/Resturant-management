import type { Metadata, Viewport } from "next";
import { THEME_SCRIPT } from "@/lib/theme-script";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Order at your table",
  description: "Scan, order and pay from your phone",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // the bottom bar, sheets and toasts pad themselves with env(safe-area-inset-*)
  interactiveWidget: "resizes-content", // Android keyboard shrinks the layout, so the dish note field stays above it
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // THEME_SCRIPT puts .dark / .light on <html> before React loads, so its class differs from the server's on purpose
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
