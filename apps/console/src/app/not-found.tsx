import { Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-(--sunken) text-brand">
        <Compass className="h-8 w-8" aria-hidden />
      </span>
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="muted">That address doesn&apos;t exist in the console.</p>
      <a href="/" className="tap inline-flex items-center rounded-xl bg-brand px-5 font-semibold text-white">
        Go to my screen
      </a>
    </main>
  );
}
