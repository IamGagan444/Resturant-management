"use client";

import { useState, type FormEvent } from "react";
import type { MfaSetup } from "@rms/contracts";
import { describeError } from "@/lib/errors";
import { Button, Field, FormError } from "@/components/ui";

/** Scan the QR (or type the key), then type a code from the app. Used at first sign-in and when moving phones. */
export function ScanAndConfirm({
  setup,
  onConfirm,
  onCancel,
  submitLabel = "Turn on",
}: {
  setup: MfaSetup;
  onConfirm: (code: string) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onConfirm(code.trim());
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 sm:flex-row sm:items-start" noValidate>
      <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={180} height={180} className="self-center rounded-lg bg-white p-2 sm:self-start" />
      <div className="flex flex-1 flex-col gap-3">
        <p className="text-sm">
          Scan with Google Authenticator, Microsoft Authenticator or 1Password. Can&apos;t scan? Enter this key:{" "}
          <code className="font-mono break-all">{setup.secret}</code>
        </p>
        <Field label="6-digit code from the app">
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
        </Field>
        <FormError message={error} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || code.trim().length !== 6}>
            {busy ? "Checking…" : submitLabel}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

/** One-time recovery codes, shown once right after an authenticator is set up. */
export function RecoveryCodes({ codes, onDone, doneLabel = "I've saved them" }: { codes: string[]; onDone: () => void; doneLabel?: string }) {
  return (
    <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
      <p className="font-semibold">Save these recovery codes</p>
      <p className="muted mt-1 text-sm">Each one signs you in once if you lose your phone. They won&apos;t be shown again.</p>
      <ul className="mt-3 grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button variant="outline" className="mt-3" onClick={onDone}>
        {doneLabel}
      </Button>
    </div>
  );
}
