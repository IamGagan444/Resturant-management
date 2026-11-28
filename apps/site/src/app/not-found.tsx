import type { Metadata } from "next";

export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <h1 className="text-4xl font-extrabold">Page not found</h1>
        <p className="mt-3 text-muted">That page doesn&apos;t exist.</p>
        <a href="/" className="mt-6 inline-flex rounded-full bg-brand px-6 py-3 font-semibold text-brand-ink">
          Go to the home page
        </a>
      </div>
    </main>
  );
}
