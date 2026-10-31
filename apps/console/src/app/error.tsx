"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

/** Last-resort screen if a page crashes: say so plainly and offer a reload, instead of a blank page. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-late/10 text-late">
        <AlertTriangle className="h-8 w-8" aria-hidden />
      </span>
      <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
      <p className="muted">This screen hit a problem. Your data is safe. Try again, and if it keeps happening, reload the page.</p>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Try again
        </Button>
        <Button variant="outline" onClick={() => location.reload()}>
          Reload page
        </Button>
      </div>
    </main>
  );
}
