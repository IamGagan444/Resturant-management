"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HotelStatus } from "@rms/contracts";
import { api } from "@/lib/api";
import { useGuard } from "@/lib/auth";
import { Activity, AlertTriangle, Building2, CloudOff, ShoppingBag, Utensils } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorText, Field, Stat, TopBar } from "@/components/ui";

interface HotelRow {
  id: string;
  name: string;
  slug: string;
  status: HotelStatus;
  plan: { id: string; name: string } | null;
  trialEndsAt: string | null;
  tables: number;
  staff: number;
}
interface Plan { id: string; name: string; priceMonthly: number }
interface Health { activeHotels: number; ordersLast24h: number; failedPaymentsLast24h: number; failedSyncsLast24h: number; liveSessions: number }

const STATUSES: HotelStatus[] = ["TRIAL", "ACTIVE", "SUSPENDED", "CANCELLED"];

/** Super admin: onboard hotels, change plan/status, watch platform health. */
export default function PlatformPage() {
  const me = useGuard("platform");
  const qc = useQueryClient();
  const hotels = useQuery({ queryKey: ["p", "hotels"], queryFn: () => api<HotelRow[]>("GET", "/v1/platform/hotels"), enabled: Boolean(me) });
  const plans = useQuery({ queryKey: ["p", "plans"], queryFn: () => api<Plan[]>("GET", "/v1/platform/plans"), enabled: Boolean(me) });
  const health = useQuery({ queryKey: ["p", "health"], queryFn: () => api<Health>("GET", "/v1/platform/health"), enabled: Boolean(me), refetchInterval: 60_000 });
  const [error, setError] = useState<unknown>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["p"] });
  const patch = (id: string, body: object) => api("PATCH", `/v1/platform/hotels/${id}`, body).then(refresh, setError);

  if (!me) return null;
  return (
    <div className="min-h-dvh">
      <TopBar title="Platform" subtitle="Super admin" />
      <main className="mx-auto max-w-6xl space-y-6 px-3 py-5 sm:px-6 sm:py-8">
        {health.data && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Active hotels" value={health.data.activeHotels} icon={Building2} />
            <Stat label="Live tables" value={health.data.liveSessions} icon={Utensils} />
            <Stat label="Orders (24h)" value={health.data.ordersLast24h} icon={ShoppingBag} />
            <Stat label="Failed payments (24h)" value={health.data.failedPaymentsLast24h} bad={health.data.failedPaymentsLast24h > 0} icon={AlertTriangle} />
            <Stat label="Failed syncs (24h)" value={health.data.failedSyncsLast24h} bad={health.data.failedSyncsLast24h > 0} icon={CloudOff} />
          </div>
        )}

        <Card className="p-0 sm:p-0">
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
            <CardHeader title="Hotels" hint="Change a hotel's status, plan or trial end; it applies immediately." action={<Badge tone="brand">{hotels.data?.length ?? 0} total</Badge>} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="muted line border-y bg-(--sunken) text-xs tracking-wide uppercase">
                <tr className="[&>th]:px-4 [&>th]:py-2.5 [&>th]:font-semibold">
                  <th>Name</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Trial ends</th>
                  <th>Tables / staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--line) [&_td]:px-4 [&_td]:py-2.5">
                {hotels.data?.map((h) => (
                  <tr key={h.id} className="transition hover:bg-(--sunken)/60">
                    <td className="font-semibold">
                      <span className="flex items-center gap-2.5">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-xs font-bold text-brand">{h.name.slice(0, 2).toUpperCase()}</span>
                        {h.name}
                      </span>
                    </td>
                    <td className="muted font-mono text-xs">/h/{h.slug}</td>
                    <td>
                      <select aria-label={`Status of ${h.name}`} value={h.status} onChange={(e) => void patch(h.id, { status: e.target.value })}>
                        {STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select aria-label={`Plan of ${h.name}`} value={h.plan?.id ?? ""} onChange={(e) => void patch(h.id, { planId: e.target.value || null })}>
                        <option value="">—</option>
                        {plans.data?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="date"
                        aria-label={`Trial end for ${h.name}`}
                        value={h.trialEndsAt?.slice(0, 10) ?? ""}
                        onChange={(e) => void patch(h.id, { trialEndsAt: e.target.value ? new Date(`${e.target.value}T23:59:59Z`).toISOString() : null })}
                      />
                    </td>
                    <td className="tabular-nums">
                      {h.tables} / {h.staff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hotels.data?.length === 0 && (
              <p className="muted flex items-center justify-center gap-2 py-10 text-sm">
                <Activity className="h-4 w-4" aria-hidden />
                No hotels yet. Onboard the first one below.
              </p>
            )}
          </div>
          <div className="px-4 pb-4 sm:px-5">
            <ErrorText error={error} />
          </div>
        </Card>

        <CreateHotel plans={plans.data ?? []} onCreated={refresh} />
      </main>
    </div>
  );
}

function CreateHotel({ plans, onCreated }: { plans: Plan[]; onCreated: () => void }) {
  const empty = { name: "", slug: "", planId: "", ownerName: "", ownerEmail: "", ownerPassword: "", ownerPin: "" };
  const [f, setF] = useState(empty);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("POST", "/v1/platform/hotels", {
        name: f.name,
        slug: f.slug,
        planId: f.planId || null,
        status: "TRIAL",
        trialEndsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        owner: { name: f.ownerName, email: f.ownerEmail, password: f.ownerPassword, pin: f.ownerPin },
      });
      setDone(`${f.name} created. Owner signs in with ${f.ownerEmail}.`);
      setF(empty);
      onCreated();
    } catch (err) {
      setError(err);
    }
  }

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  return (
    <Card>
      <CardHeader title="Onboard a hotel" hint="Creates the hotel, its owner login and a 14-day trial." />
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Hotel name">
          <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug || slugify(e.target.value) })} />
        </Field>
        <Field label="URL name" hint="Used in QR links">
          <input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })} />
        </Field>
        <Field label="Plan">
          <select value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">—</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner name">
          <input required value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} />
        </Field>
        <Field label="Owner email">
          <input required type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} />
        </Field>
        <Field label="Owner password">
          <input required type="password" minLength={8} value={f.ownerPassword} onChange={(e) => setF({ ...f, ownerPassword: e.target.value })} />
        </Field>
        <Field label="Owner PIN">
          <input required inputMode="numeric" pattern="\d{4,6}" value={f.ownerPin} onChange={(e) => setF({ ...f, ownerPin: e.target.value.replace(/\D/g, "") })} />
        </Field>
        <Button type="submit" className="self-end">
          Create hotel (14-day trial)
        </Button>
      </form>
      <ErrorText error={error} />
      {done && <p className="mt-3 rounded-lg bg-fresh/10 px-3 py-2 text-sm font-semibold text-fresh">{done}</p>}
    </Card>
  );
}
