import { QrCode } from "lucide-react";

export default function Home() {
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_35%,color-mix(in_oklab,var(--color-brand)_14%,transparent),transparent_60%)]"
      />
      <span className="grid h-20 w-20 place-items-center rounded-3xl bg-linear-to-br from-brand-2 to-brand text-white shadow-lift">
        <QrCode className="h-10 w-10" aria-hidden />
      </span>
      <h1 className="font-display mt-2 text-3xl leading-tight font-semibold">Scan the QR code on your table</h1>
      <p className="muted max-w-xs">You&apos;ll see the menu and can order straight from your phone.</p>
    </main>
  );
}
