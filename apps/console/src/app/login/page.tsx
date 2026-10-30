"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { Me } from "@rms/contracts";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/auth";
import { Button, ErrorText, Field } from "@/components/ui";

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
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-6">
      <h1 className="text-2xl font-bold">Sign in</h1>
      <p className="muted mb-6 text-sm">Owners, managers and platform admins.</p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email">
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <Link href="/device/" className="muted mt-6 text-center text-sm underline">
        Staff: sign in with PIN on this device
      </Link>
    </main>
  );
}
