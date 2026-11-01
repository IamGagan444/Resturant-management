import { QrCode } from "lucide-react";

export default function Home() {
  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="grid h-20 w-20 place-items-center rounded-3xl bg-brand text-brand-ink">
        <QrCode className="h-10 w-10" aria-hidden />
      </span>
      <h1 className="font-display mt-2 text-3xl leading-tight font-bold">Scan the QR code on your table</h1>
      <p className="muted max-w-xs">You&apos;ll see the menu and can order straight from your phone.</p>
    </main>
  );
}
