"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Nfc } from "lucide-react";
import { nfcSupported, writeNfcUrl } from "@/lib/nfc";
import { Button } from "@/components/ui";
import { notify } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";

type State = "idle" | "waiting" | "done" | "error";

/** "Write NFC card" for one link: Web NFC where the browser has it, copy-the-link steps everywhere else. */
export function NfcWriteButton({ url, what, variant = "outline", className, compact = false }: { url: string; what: string; variant?: "outline" | "ghost" | "subtle"; className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lock, setLock] = useState(false);
  const [supported, setSupported] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => setSupported(nfcSupported()), []);
  useEffect(() => () => abort.current?.abort(), []);

  function close(o: boolean) {
    if (!o) {
      abort.current?.abort();
      setState("idle");
      setError(null);
    }
    setOpen(o);
  }

  async function start() {
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setState("waiting");
    setError(null);
    try {
      await writeNfcUrl(url, { signal: ctrl.signal, lock });
      setState("done");
      notify.ok(`NFC card written for ${what}`);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setState("error");
      setError(e instanceof Error && e.name === "NotAllowedError" ? "NFC permission was refused. Allow NFC for this site and try again." : "Couldn't write the card. Hold it still against the back of the phone and try again.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      notify.ok("Link copied");
    } catch {
      notify.error("Couldn't copy. Select the link and copy it.");
    }
  }

  return (
    <>
      {compact ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`NFC card for ${what}`}
          title="NFC card"
          className="muted grid h-9 w-9 shrink-0 place-items-center rounded-full transition hover:bg-(--sunken) hover:text-brand"
        >
          <Nfc className="h-4 w-4" aria-hidden />
        </button>
      ) : (
        <Button type="button" variant={variant} className={className} onClick={() => setOpen(true)}>
          <Nfc className="h-4 w-4" aria-hidden />
          NFC card
        </Button>
      )}
      <Modal
        open={open}
        onOpenChange={close}
        title={`NFC card for ${what}`}
        description="Guests tap their phone on the card and the page opens. No app needed: works on iPhones and Android phones with NFC."
        footer={
          <Button type="button" variant="outline" onClick={() => close(false)}>
            Close
          </Button>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="line flex items-center gap-2 rounded-xl border bg-(--sunken) p-2 pl-3">
            <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
            <Button type="button" variant="ghost" className="h-9 min-h-9 px-3 text-xs" onClick={() => void copy()}>
              <Copy className="h-3.5 w-3.5" aria-hidden /> Copy
            </Button>
          </div>
          {supported ? (
            <>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5" checked={lock} onChange={(e) => setLock(e.target.checked)} disabled={state === "waiting"} />
                <span>
                  Lock the card after writing <span className="muted block text-xs">Stops anyone re-writing it with a different link. This can&apos;t be undone.</span>
                </span>
              </label>
              {state === "waiting" ? (
                <p className="flex items-center gap-2 rounded-xl bg-brand/10 p-3 font-medium text-brand" role="status">
                  <Nfc className="h-5 w-5 animate-pulse" aria-hidden /> Hold the NFC card flat against the back of this phone…
                </p>
              ) : state === "done" ? (
                <p className="flex items-center gap-2 rounded-xl bg-fresh/12 p-3 font-medium text-fresh" role="status">
                  <Check className="h-5 w-5" aria-hidden /> Done. Tap the card with any phone to test it.
                </p>
              ) : null}
              {error && (
                <p role="alert" className="rounded-xl bg-late/10 p-3 font-medium text-late">
                  {error}
                </p>
              )}
              {state !== "waiting" && (
                <Button type="button" onClick={() => void start()}>
                  <Nfc className="h-4 w-4" aria-hidden /> {state === "done" ? "Write another card" : "Write card"}
                </Button>
              )}
            </>
          ) : (
            <ol className="muted list-decimal space-y-1.5 pl-5">
              <li>Open this page in Chrome on an Android phone to write cards directly, or:</li>
              <li>Install the free “NFC Tools” app on any phone.</li>
              <li>Write → Add a record → URL, paste the link above, then hold the card to the phone.</li>
            </ol>
          )}
        </div>
      </Modal>
    </>
  );
}
