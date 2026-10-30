export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-5xl" aria-hidden>
        📱
      </div>
      <h1 className="text-xl font-semibold">Scan the QR code on your table</h1>
      <p className="muted">You&apos;ll see the menu and can order straight from your phone.</p>
    </main>
  );
}
