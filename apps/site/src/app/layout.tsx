import type { Metadata, Viewport } from "next";
import { SITE } from "@/site";
import { fontVariables } from "./fonts";
import "./globals.css";

// Same key as the guest app and console, so a saved light/dark choice carries over on one domain.
const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("rms.theme");var d=p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.classList.toggle("light",!d)}catch(e){}})()`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}: ${SITE.title}`, template: `%s | ${SITE.name}` },
  description: SITE.description,
  keywords: [...SITE.keywords],
  applicationName: SITE.name,
  authors: [{ name: SITE.name, url: SITE.url }],
  creator: SITE.name,
  publisher: SITE.name,
  category: "business",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE.name,
    title: `${SITE.name}: ${SITE.title}`,
    description: SITE.description,
    locale: "en_IN",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name}: ${SITE.title}`,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#111113" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={fontVariables} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-bg font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
