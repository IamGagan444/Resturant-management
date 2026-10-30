"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { HotelStatus } from "@rms/contracts";
import { api } from "@/lib/api";
import { useGuard } from "@/lib/auth";
import { Button, Card, ErrorText, Field, TopBar } from "@/components/ui";

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
      <TopBar title="Platform" />
      <main className="mx-auto max-w-6xl space-y-6 p-4">
        {health.data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Tile label="Active hotels" value={health.data.activeHotels} />
            <Tile label="Live tables" value={health.data.liveSessions} />
            <Tile label="Orders (24h)" value={health.data.ordersLast24h} />
            <Tile label="Failed payments (24h)" value={health.data.failedPaymentsLast24h} bad={health.data.failedPaymentsLast24h > 0} />
            <Tile label="Failed syncs (24h)" value={health.data.failedSyncsLast24h} bad={health.data.failedSyncsLast24h > 0} />
          </div>
        )}

        <Card>
          <h2 className="mb-3 text-lg font-bold">Hotels</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="muted">
                <tr>
                  <th className="py-2">Name</th>
                  <th>URL</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Trial ends</th>
                  <th>Tables / staff</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--line)">
                {hotels.data?.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 font-semibold">{h.name}</td>
                    <td className="muted">/h/{h.slug}</td>
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
                    <td>
                      {h.tables} / {h.staff}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ErrorText error={error} />
        </Card>

        <CreateHotel plans={plans.data ?? []} onCreated={refresh} />
      </main>
    </div>
  );
}

function Tile({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <Card className={bad ? "border-late" : ""}>
      <p className="muted text-xs">{label}</p>
      <p className={`text-3xl font-black ${bad ? "text-late" : ""}`}>{value}</p>
    </Card>
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
      <h2 className="mb-3 text-lg font-bold">Onboard a hotel</h2>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
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
      {done && <p className="mt-2 text-fresh">{done}</p>}
    </Card>
  );
}
