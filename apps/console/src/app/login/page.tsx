"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LoginInput, type Me } from "@rms/contracts";
import { api } from "@/lib/api";
import { homeFor } from "@/lib/auth";
import { ArrowRight, KeyRound } from "lucide-react";
import { AuthAside } from "@/components/AuthAside";
import { Button, Field, FormError, useForm } from "@/components/ui";
import { RestroLogo } from "@/components/RestroMark";

/** Email + password: super admin, hotel owner and managers. */
export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const form = useForm({ initial: { email: "", password: "" }, schema: LoginInput, build: (v) => ({ email: v.email.trim(), password: v.password }) });
  const busy = form.busy;

  const submit = form.submit(async (body) => {
    await api("POST", "/v1/auth/login", body);
    const me = await api<Me>("GET", "/v1/auth/me");
    qc.setQueryData(["me"], me);
    router.replace(homeFor(me));
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <AuthAside />
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="stagger mx-auto w-full max-w-sm">
          <RestroLogo className="mb-8 lg:hidden" markClass="h-12 w-12" animated />
          <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
          <p className="muted mt-1.5 mb-8 text-sm">Sign in to run your restaurant. For owners, managers and platform admins.</p>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <Field label="Email" required error={form.error("email")}>
              <input {...form.text("email")} type="email" autoComplete="username" inputMode="email" />
            </Field>
            <Field label="Password" required error={form.error("password")}>
              <input {...form.text("password")} type="password" autoComplete="current-password" />
            </Field>
            <FormError message={form.formError} />
            <Button type="submit" disabled={busy} className="mt-2">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <div className="line my-8 border-t" />
          <Link href="/device/" className="line surface lift group flex items-center gap-3 rounded-2xl border p-4 text-sm shadow-soft hover:border-brand/40">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/12 text-brand">
              <KeyRound className="h-5 w-5" aria-hidden />
            </span>
            <span className="flex-1 font-semibold">Staff: sign in with PIN on this device</span>
            <ArrowRight className="muted h-4 w-4 transition group-hover:translate-x-1 group-hover:text-brand" aria-hidden />
          </Link>
        </div>
      </main>
    </div>
  );
}
