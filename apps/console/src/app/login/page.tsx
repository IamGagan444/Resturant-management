"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { LoginInput, type LoginResult, type Me, type MfaEnabled, type MfaSetup } from "@rms/contracts";
import { describeError } from "@/lib/errors";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/auth";
import { ArrowRight, KeyRound } from "lucide-react";
import { AuthAside } from "@/components/AuthAside";
import { Button, Field, FormError, useForm } from "@/components/ui";
import { RestroLogo } from "@/components/RestroMark";
import { RecoveryCodes, ScanAndConfirm } from "@/components/Authenticator";

type Stage =
  | { step: "password" }
  | { step: "code"; mfaToken: string } // has an authenticator: type its code
  | { step: "enroll"; mfaToken: string; setup: MfaSetup | null } // none yet: set one up now (required)
  | { step: "codes"; codes: string[] }; // just set up: save the recovery codes, then in

/** Email + password, then the authenticator code: super admin, hotel owner and managers. */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const form = useForm({ initial: { email: "", password: "" }, schema: LoginInput, build: (v) => ({ email: v.email.trim(), password: v.password }) });
  const [stage, setStage] = useState<Stage>({ step: "password" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = async () => {
    const me = await api<Me>("GET", "/v1/auth/me");
    qc.setQueryData(["me"], me);
    router.replace(homeFor(me));
  };

  const back = () => {
    setStage({ step: "password" });
    setCode("");
    setError(null);
  };

  const submit = form.submit(async (body) => {
    const r = await api<LoginResult>("POST", "/v1/auth/login", body);
    setError(null);
    if (r.mfaRequired && r.mfaToken) return setStage({ step: "code", mfaToken: r.mfaToken });
    if (r.mfaSetupRequired && r.mfaToken) {
      const setup = await api<MfaSetup>("POST", "/v1/auth/mfa/enroll/start", { mfaToken: r.mfaToken });
      return setStage({ step: "enroll", mfaToken: r.mfaToken, setup });
    }
    await finish();
  });

  const submitCode = async (e: FormEvent) => {
    e.preventDefault();
    if (stage.step !== "code") return;
    setBusy(true);
    setError(null);
    try {
      await api<LoginResult>("POST", "/v1/auth/login/mfa", { mfaToken: stage.mfaToken, code: code.trim() });
      await finish();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const enroll = async (c: string) => {
    if (stage.step !== "enroll") return;
    const r = await api<MfaEnabled>("POST", "/v1/auth/mfa/enroll/finish", { mfaToken: stage.mfaToken, code: c });
    setStage({ step: "codes", codes: r.recoveryCodes }); // signed in now; show the codes before moving on
  };

  const heading: Record<Stage["step"], [string, string]> = {
    password: ["Welcome back", "Sign in to run your restaurant. For owners, managers and platform admins."],
    code: ["Two-step sign-in", "Enter the 6-digit code from your authenticator app."],
    enroll: ["Protect your account", "Admin sign-in needs a code from an authenticator app on your phone. Set it up once — it takes a minute."],
    codes: ["You're all set", "Two-step sign-in is on."],
  };
  const [title, hint] = heading[stage.step];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <AuthAside />
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className={`stagger mx-auto w-full ${stage.step === "enroll" || stage.step === "codes" ? "max-w-xl" : "max-w-sm"}`}>
          <RestroLogo className="mb-8 lg:hidden" markClass="h-12 w-12" animated />
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="muted mt-1.5 mb-8 text-sm">{hint}</p>

          {stage.step === "password" && (
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <Field label="Email" required error={form.error("email")}>
                <input {...form.text("email")} type="email" autoComplete="username" inputMode="email" />
              </Field>
              <Field label="Password" required error={form.error("password")}>
                <input {...form.text("password")} type="password" autoComplete="current-password" />
              </Field>
              <FormError message={form.formError} />
              <Button type="submit" disabled={form.busy} className="mt-2">
                {form.busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          )}

          {stage.step === "code" && (
            <form onSubmit={submitCode} className="flex flex-col gap-4" noValidate>
              <Field label="Code from your authenticator app" required hint="Lost your phone? Enter one of your recovery codes.">
                <input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" autoFocus maxLength={20} />
              </Field>
              <FormError message={error} />
              <Button type="submit" disabled={busy || code.trim().length < 6} className="mt-2">
                {busy ? "Checking…" : "Verify"}
              </Button>
              <button type="button" className="muted text-sm underline" onClick={back}>
                Back to password
              </button>
            </form>
          )}

          {stage.step === "enroll" && stage.setup && <ScanAndConfirm setup={stage.setup} onConfirm={enroll} onCancel={back} submitLabel="Turn on and sign in" />}

          {stage.step === "codes" && <RecoveryCodes codes={stage.codes} onDone={() => void finish()} doneLabel="I've saved them — continue" />}

          {stage.step === "password" && (
            <>
              <div className="line my-8 border-t" />
              <Link href="/device/" className="line surface lift group flex items-center gap-3 rounded-2xl border p-4 text-sm shadow-soft hover:border-brand/40">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/12 text-brand">
                  <KeyRound className="h-5 w-5" aria-hidden />
                </span>
                <span className="flex-1 font-semibold">Staff: sign in with PIN on this device</span>
                <ArrowRight className="muted h-4 w-4 transition group-hover:translate-x-1 group-hover:text-brand" aria-hidden />
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
