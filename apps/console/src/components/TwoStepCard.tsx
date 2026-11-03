"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MfaEnabled, MfaSetup, MfaStatus } from "@rms/contracts";
import { Smartphone } from "lucide-react";
import { api } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { Badge, Button, Card, CardHeader, Field, FormError } from "@/components/ui";
import { notify } from "@/components/ui/feedback";
import { RecoveryCodes, ScanAndConfirm } from "@/components/Authenticator";

/**
 * Two-step sign-in for the signed-in person's own email + password login.
 * Required: it was set up at first sign-in; here it can be moved to a new phone (password + a current code).
 */
export function TwoStepCard() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["mfa"], queryFn: () => api<MfaStatus>("GET", "/v1/auth/mfa") });
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status.data?.available) return null; // PIN-only staff: nothing to protect here
  const { enabled, required, recoveryCodesLeft } = status.data;

  const run = (fn: () => Promise<void>) => async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const start = run(async () => {
    setSetup(await api<MfaSetup>("POST", "/v1/auth/mfa/setup", { password, ...(enabled && { code: code.trim() }) }));
    setPassword("");
    setCode("");
  });
  const confirm = async (c: string) => {
    const r = await api<MfaEnabled>("POST", "/v1/auth/mfa/enable", { code: c });
    setCodes(r.recoveryCodes);
    setSetup(null);
    void qc.invalidateQueries({ queryKey: ["mfa"] });
  };
  const disable = run(async () => {
    await api("POST", "/v1/auth/mfa/disable", { password, code: code.trim() });
    setPassword("");
    setCode("");
    notify.ok("Two-step sign-in is off");
    void qc.invalidateQueries({ queryKey: ["mfa"] });
  });

  return (
    <Card>
      <CardHeader
        title="Two-step sign-in"
        hint={
          enabled
            ? `After your password, sign-in asks for a code from your authenticator app. ${recoveryCodesLeft} recovery codes left.`
            : "After your password, sign-in also asks for a code from an authenticator app on your phone."
        }
        action={enabled ? <Badge tone="fresh">On</Badge> : <Badge>Off</Badge>}
      />

      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}

      {!codes && setup && <ScanAndConfirm setup={setup} onConfirm={confirm} onCancel={() => setSetup(null)} submitLabel={enabled ? "Switch to this phone" : "Turn on"} />}

      {!codes && !setup && (
        <form onSubmit={start} className="flex flex-wrap items-end gap-3" noValidate>
          <Field label="Your password" className="min-w-48 flex-1">
            <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {enabled && (
            <Field label="Current code or a recovery code" className="min-w-48 flex-1">
              <input autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          <Button type="submit" disabled={busy || !password || (enabled && !code)}>
            <Smartphone className="h-4 w-4" aria-hidden />
            {enabled ? "Move to a new phone" : "Set up"}
          </Button>
          {enabled && !required && (
            <Button type="button" variant="outline" disabled={busy || !password || !code} onClick={disable}>
              Turn off
            </Button>
          )}
        </form>
      )}
      <div className="mt-3">
        <FormError message={error} />
      </div>
    </Card>
  );
}
