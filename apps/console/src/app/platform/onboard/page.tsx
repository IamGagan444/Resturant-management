"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreateHotelInput, type PlatformHotel } from "@rms/contracts";
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, ClipboardCopy, CreditCard, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, Field, FormError, LinkButton, SelectField, orNull, useForm } from "@/components/ui";
import { notify } from "@/components/ui/feedback";
import { PageTitle, makePassword } from "@/components/platform/common";
import { cn } from "@/lib/utils";

interface Plan { id: string; name: string; priceMonthly: number; maxTables: number; maxStaff: number }

const STEPS = [
  { title: "Restaurant", icon: Building2, fields: ["name", "slug", "phone", "address", "gstin"] },
  { title: "Owner", icon: UserRound, fields: ["owner.name", "owner.email", "owner.phone", "owner.password", "owner.pin"] },
  { title: "Plan", icon: CreditCard, fields: ["planId", "trialEndsAt"] },
  { title: "Review", icon: Check, fields: [] as string[] },
] as const;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);

/** Super admin: onboard a restaurant in four checked steps; ends with the details to hand to the owner. */
export default function OnboardPage() {
  const qc = useQueryClient();
  const plans = useQuery({ queryKey: ["p", "plans"], queryFn: () => api<Plan[]>("GET", "/v1/platform/plans") });
  const hotels = useQuery({ queryKey: ["p", "hotels"], queryFn: () => api<PlatformHotel[]>("GET", "/v1/platform/hotels") });
  const [step, setStep] = useState(0);
  const [slugEdited, setSlugEdited] = useState(false);
  const [created, setCreated] = useState<{ name: string; slug: string; email: string; password: string; pin: string } | null>(null);

  const form = useForm({
    initial: {
      name: "",
      slug: "",
      phone: "",
      address: "",
      gstin: "",
      planId: "",
      startAs: "TRIAL",
      trialDays: "14",
      "owner.name": "",
      "owner.email": "",
      "owner.phone": "",
      "owner.password": makePassword(),
      "owner.pin": "",
    },
    schema: CreateHotelInput,
    build: (v) => ({
      name: v.name.trim(),
      slug: v.slug,
      phone: orNull(v.phone),
      address: orNull(v.address),
      gstin: orNull(v.gstin.toUpperCase()),
      planId: orNull(v.planId),
      status: v.startAs,
      trialEndsAt: v.startAs === "TRIAL" ? new Date(Date.now() + Number(v.trialDays) * 86_400_000).toISOString() : null,
      owner: {
        name: v["owner.name"].trim(),
        email: v["owner.email"].trim().toLowerCase(),
        phone: orNull(v["owner.phone"]),
        password: v["owner.password"],
        pin: v["owner.pin"],
      },
    }),
  });
  const v = form.values;
  const slugTaken = Boolean(v.slug) && (hotels.data ?? []).some((h) => h.slug === v.slug);
  const emailTaken = Boolean(v["owner.email"]) && (hotels.data ?? []).some((h) => h.owner?.email?.toLowerCase() === v["owner.email"].trim().toLowerCase());

  function next() {
    const ok = form.check([...STEPS[step]!.fields]);
    if (!ok) return;
    if (step === 0 && slugTaken) return;
    if (step === 1 && emailTaken) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  const create = form.submit(async (body) => {
    await api("POST", "/v1/platform/hotels", body);
    void qc.invalidateQueries({ queryKey: ["p"] });
    setCreated({ name: body.name, slug: body.slug, email: body.owner.email, password: body.owner.password, pin: body.owner.pin });
    notify.ok(`${body.name} is ready`);
  });

  if (created) return <Done created={created} onAnother={() => (form.reset({ ...form.values, name: "", slug: "", phone: "", address: "", gstin: "", "owner.name": "", "owner.email": "", "owner.phone": "", "owner.password": makePassword(), "owner.pin": "" }), setSlugEdited(false), setStep(0), setCreated(null))} />;

  const plan = plans.data?.find((p) => p.id === v.planId);
  return (
    <>
      <PageTitle title="Onboard a restaurant" hint="Creates the restaurant, the owner's login and sensible defaults (GST 5%, a kitchen station, one floor)." />

      <ol className="mb-6 grid grid-cols-4 gap-2" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              disabled={i > step}
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex w-full flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-xs font-semibold transition sm:flex-row sm:gap-2.5 sm:px-3 sm:text-sm",
                i === step ? "bg-(--surface) text-brand shadow-soft ring-1 ring-(--line)" : i < step ? "text-(--ink) hover:bg-(--sunken)" : "text-(--muted)",
              )}
            >
              <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full", i < step ? "bg-fresh text-white" : i === step ? "bg-brand text-brand-ink" : "bg-(--sunken)")}>
                {i < step ? <Check className="h-4 w-4" aria-hidden /> : <s.icon className="h-4 w-4" aria-hidden />}
              </span>
              {s.title}
            </button>
          </li>
        ))}
      </ol>

      <Card className="max-w-3xl">
        <form onSubmit={step === STEPS.length - 1 ? create : (e) => (e.preventDefault(), next())} noValidate>
          {step === 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Restaurant name" required error={form.error("name")} className="sm:col-span-2">
                <input
                  {...form.text("name")}
                  onChange={(e) => {
                    form.set("name", e.target.value);
                    if (!slugEdited) form.set("slug", slugify(e.target.value));
                  }}
                  maxLength={80}
                  placeholder="e.g. Durga Hotel"
                  autoFocus
                />
              </Field>
              <Field
                label="Web address"
                required
                error={form.error("slug") ?? (slugTaken ? "Another restaurant already uses this address" : undefined)}
                hint={`Guests' QR codes open …/h/${v.slug || "your-restaurant"}. It can't be changed later.`}
                className="sm:col-span-2"
              >
                <input
                  {...form.text("slug")}
                  onChange={(e) => (setSlugEdited(true), form.set("slug", slugify(e.target.value)))}
                  aria-invalid={form.error("slug") || slugTaken ? true : undefined}
                  className="font-mono"
                />
              </Field>
              <Field label="Phone" error={form.error("phone")}>
                <input {...form.text("phone")} type="tel" inputMode="tel" placeholder="98765 43210" />
              </Field>
              <Field label="GSTIN" error={form.error("gstin")} hint="Can be added later">
                <input {...form.text("gstin")} onChange={(e) => form.set("gstin", e.target.value.toUpperCase())} maxLength={15} placeholder="21ABCDE1234F1Z5" />
              </Field>
              <Field label="Address" error={form.error("address")} className="sm:col-span-2">
                <textarea {...form.text("address")} rows={2} maxLength={300} />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner's name" required error={form.error("owner.name")}>
                <input {...form.text("owner.name")} maxLength={60} autoFocus />
              </Field>
              <Field label="Mobile" error={form.error("owner.phone")}>
                <input {...form.text("owner.phone")} type="tel" inputMode="tel" placeholder="98765 43210" />
              </Field>
              <Field
                label="Email (their login)"
                required
                error={form.error("owner.email") ?? (emailTaken ? "This email already has an account" : undefined)}
                className="sm:col-span-2"
              >
                <input {...form.text("owner.email")} type="email" autoComplete="off" aria-invalid={form.error("owner.email") || emailTaken ? true : undefined} />
              </Field>
              <Field label="Password" required error={form.error("owner.password")} hint="At least 8 characters. You'll see it once more at the end to share.">
                <div className="flex gap-2">
                  <input {...form.text("owner.password")} type="text" autoComplete="off" className="min-w-0 flex-1 font-mono" />
                  <Button type="button" variant="outline" className="shrink-0 text-sm" onClick={() => form.set("owner.password", makePassword())}>
                    New
                  </Button>
                </div>
              </Field>
              <Field label="PIN" required error={form.error("owner.pin")} hint="6 digits, for signing in on a Manager device">
                <input {...form.text("owner.pin")} onChange={(e) => form.set("owner.pin", e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="off" />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Plan" hint={plan ? `Up to ${plan.maxTables} tables and ${plan.maxStaff} staff` : "Can be chosen later"} className="sm:col-span-2">
                <SelectField value={v.planId} onChange={(p) => form.set("planId", p)} emptyLabel="No plan yet" options={(plans.data ?? []).map((p) => ({ value: p.id, label: `${p.name} · ₹${p.priceMonthly / 100}/month` }))} />
              </Field>
              <Field label="Start as" required>
                <SelectField
                  value={v.startAs}
                  onChange={(s) => form.set("startAs", s)}
                  options={[
                    { value: "TRIAL", label: "Free trial" },
                    { value: "ACTIVE", label: "Active (paying)" },
                  ]}
                />
              </Field>
              {v.startAs === "TRIAL" && (
                <Field label="Trial length" required>
                  <SelectField
                    value={v.trialDays}
                    onChange={(d) => form.set("trialDays", d)}
                    options={["7", "14", "30", "60"].map((d) => ({ value: d, label: `${d} days` }))}
                  />
                </Field>
              )}
            </div>
          )}

          {step === 3 && (
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Review label="Restaurant" value={v.name} />
              <Review label="Web address" value={`/h/${v.slug}`} mono />
              <Review label="Phone" value={v.phone || "—"} />
              <Review label="GSTIN" value={v.gstin || "—"} />
              <Review label="Owner" value={`${v["owner.name"]}${v["owner.phone"] ? ` · ${v["owner.phone"]}` : ""}`} />
              <Review label="Login email" value={v["owner.email"]} />
              <Review label="Plan" value={plan?.name ?? "No plan yet"} />
              <Review label="Starts as" value={v.startAs === "TRIAL" ? `Free trial, ${v.trialDays} days` : "Active"} />
            </dl>
          )}

          <div className="mt-6">
            <FormError message={form.formError} />
          </div>
          <div className="line mt-4 flex items-center justify-between gap-2 border-t pt-4">
            <Button type="button" variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="submit">
                Continue
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            ) : (
              <Button type="submit" disabled={form.busy}>
                {form.busy ? "Creating…" : "Create restaurant"}
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  );
}

function Review({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="line border-b pb-2">
      <dt className="muted text-xs">{label}</dt>
      <dd className={cn("font-semibold break-words", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

function Done({ created, onAnother }: { created: { name: string; slug: string; email: string; password: string; pin: string }; onAnother: () => void }) {
  const login = typeof location === "undefined" ? "/login/" : `${location.origin}/login/`;
  const text = `${created.name} is set up.\nSign in: ${login}\nEmail: ${created.email}\nPassword: ${created.password}\nPIN for shared devices: ${created.pin}`;
  return (
    <Card className="mx-auto max-w-xl text-center">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-fresh/12 text-fresh">
        <CheckCircle2 className="h-9 w-9" aria-hidden />
      </span>
      <h1 className="font-display mt-4 text-2xl font-bold">{created.name} is ready</h1>
      <p className="muted mt-1 text-sm">Send these details to the owner privately. The password isn&apos;t shown again.</p>
      <pre className="mt-5 rounded-2xl bg-(--sunken) p-4 text-left font-mono text-sm whitespace-pre-wrap select-all">{text}</pre>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button variant="outline" onClick={() => void navigator.clipboard.writeText(text).then(() => notify.ok("Copied"), () => notify.error(new Error("Couldn't copy; select the text instead.")))}>
          <ClipboardCopy className="h-4 w-4" aria-hidden />
          Copy
        </Button>
        <Button variant="outline" onClick={onAnother}>
          Onboard another
        </Button>
        <LinkButton href="/platform/restaurants/" variant="primary">
          All restaurants
        </LinkButton>
      </div>
    </Card>
  );
}
