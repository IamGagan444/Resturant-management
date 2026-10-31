"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Me } from "@rms/contracts";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/auth";
import { ArrowRight, KeyRound } from "lucide-react";
import { AuthAside } from "@/components/AuthAside";
import { BrandMark, Button, ErrorText, Field } from "@/components/ui";

/** Email + password: super admin, hotel owner and managers. */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/v1/auth/login", { email, password });
      const me = await api<Me>("GET", "/v1/auth/me");
      qc.setQueryData(["me"], me);
      router.replace(homeFor(me));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <AuthAside />
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <BrandMark className="h-11 w-11 text-xl lg:hidden" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight lg:mt-0">Sign in</h1>
          <p className="muted mt-1.5 mb-8 text-sm">Owners, managers and platform admins.</p>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Field label="Email">
              <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            <ErrorText error={error} />
            <Button type="submit" disabled={busy} className="mt-2">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="line my-8 border-t" />
          <Link href="/device/" className="line surface flex items-center gap-3 rounded-2xl border p-4 text-sm shadow-soft transition hover:border-brand/40">
            <KeyRound className="h-5 w-5 text-brand" aria-hidden />
            <span className="flex-1 font-semibold">Staff: sign in with PIN on this device</span>
            <ArrowRight className="muted h-4 w-4" aria-hidden />
          </Link>
        </div>
      </main>
    </div>
  );
}
