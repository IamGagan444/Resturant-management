import type { Metadata, Viewport } from "next";
import { Figtree, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap", weight: ["600", "700", "800"] });

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
    { media: "(prefers-color-scheme: light)", color: "#fbf7f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0f151c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${figtree.variable}`}>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
