/**
 * Brand + SEO settings in one place. Renaming the product or moving domains = edit this file (or set the env vars).
 * The URL must be the final canonical address (https, no trailing slash): canonical tags, the sitemap,
 * Open Graph and structured data are all built from it.
 */
export const SITE = {
  name: "KOTsync",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://kotsync.com").replace(/\/+$/, ""),
  // Where "Book a demo" goes. Set before launch.
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "hello@kotsync.com",
  // Address of the staff console (owners' "Sign in" link).
  consoleUrl: process.env.NEXT_PUBLIC_CONSOLE_URL ?? "https://console.kotsync.com",
  // Google shows ~60 characters of a title (with the name) and ~155 of a description.
  title: "QR Ordering, Kitchen Display & Billing Software",
  description:
    "Restaurant software for India: guests scan a QR code to order and pay by UPI, orders reach the kitchen display instantly, GST bills and reports built in.",
  keywords: [
    "QR code menu ordering",
    "restaurant POS India",
    "kitchen display system",
    "KOT software",
    "restaurant billing software",
    "UPI table payment",
    "GST billing restaurant",
    "waiter app",
    "hotel restaurant software",
    "contactless ordering",
  ],
} as const;

export const demoHref = `mailto:${SITE.email}?subject=${encodeURIComponent(`${SITE.name} demo`)}`;
