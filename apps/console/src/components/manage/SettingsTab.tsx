"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { CheckCircle2, Save } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorText, Field, Spinner } from "@/components/ui";

interface Settings {
  name: string;
  phone: string | null;
  address: string | null;
  gstin: string | null;
  invoicePrefix: string;
  requireWaiterConfirm: boolean;
  allowPayLater: boolean;
  pricesIncludeTax: boolean;
  serviceChargeBps: number;
  readyPickupAlertSec: number;
  dayStartsAt: string;
  razorpayConfigured: boolean;
  razorpayKeyId: string | null;
}

interface Tax { id: string; name: string; rateBps: number }

export function SettingsTab() {
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["admin", "hotel"], queryFn: () => api<Settings>("GET", "/v1/admin/hotel") });
  const taxes = useQuery({ queryKey: ["admin", "taxes"], queryFn: () => api<Tax[]>("GET", "/v1/admin/taxes") });
  const [f, setF] = useState<Settings | null>(null);
  const [rzp, setRzp] = useState({ keyId: "", keySecret: "", webhookSecret: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (s.data) setF(s.data);
  }, [s.data]);
  if (!f) return <Spinner />;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    setError(null);
    try {
      await api("PATCH", "/v1/admin/hotel", {
        name: f.name,
        phone: f.phone || null,
        address: f.address || null,
        gstin: f.gstin || null,
        invoicePrefix: f.invoicePrefix,
        requireWaiterConfirm: f.requireWaiterConfirm,
        allowPayLater: f.allowPayLater,
        pricesIncludeTax: f.pricesIncludeTax,
        serviceChargeBps: f.serviceChargeBps,
        readyPickupAlertSec: f.readyPickupAlertSec,
        dayStartsAt: f.dayStartsAt,
        ...(rzp.keyId && rzp.keySecret && rzp.webhookSecret ? { razorpay: rzp } : {}),
      });
      setRzp({ keyId: "", keySecret: "", webhookSecret: "" });
      setMsg("Saved");
      void qc.invalidateQueries({ queryKey: ["admin", "hotel"] });
    } catch (err) {
      setError(err);
    }
  }

  const check = (k: "requireWaiterConfirm" | "allowPayLater" | "pricesIncludeTax", label: string, hint: string) => (
    <label className="line flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition has-checked:border-brand/40 has-checked:bg-brand/5">
      <input type="checkbox" className="mt-0.5" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      <span>
        <span className="font-semibold">{label}</span>
        <span className="muted mt-0.5 block text-sm">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <CardHeader title="Restaurant" hint="Shown on guest menus and printed on every GST bill." />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          <Field label="Address">
            <input value={f.address ?? ""} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </Field>
          <Field label="GSTIN">
            <input value={f.gstin ?? ""} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Invoice prefix" hint="Bill numbers look like INV/2627/00042">
            <input maxLength={4} value={f.invoicePrefix} onChange={(e) => setF({ ...f, invoicePrefix: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Business day starts at" hint="Order numbers reset at this time">
            <input type="time" value={f.dayStartsAt} onChange={(e) => setF({ ...f, dayStartsAt: e.target.value })} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Ordering & billing" />
        <div className="space-y-3">
          {check("requireWaiterConfirm", "Waiter confirms first QR order", "Stops prank orders: the kitchen only sees a table's orders after a waiter confirms guests are seated.")}
          {check("allowPayLater", "Allow pay later", "Guests order now and pay at the end.")}
          {check("pricesIncludeTax", "Menu prices include GST", "Otherwise GST is added on the bill.")}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Service charge %" hint="Optional by law — guests can ask to remove it.">
              <input inputMode="decimal" value={f.serviceChargeBps / 100} onChange={(e) => setF({ ...f, serviceChargeBps: Math.round(Number(e.target.value || 0) * 100) })} />
            </Field>
            <Field label="Alert manager if food waits (seconds)">
              <input inputMode="numeric" value={f.readyPickupAlertSec} onChange={(e) => setF({ ...f, readyPickupAlertSec: Number(e.target.value || 0) })} />
            </Field>
          </div>
          <p className="muted text-sm">Taxes: {taxes.data?.map((t) => `${t.name} ${t.rateBps / 100}%`).join(" + ")}</p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="UPI payments (Razorpay)"
          hint={f.razorpayConfigured ? `Connected (${f.razorpayKeyId}). Enter new keys only to replace them.` : "Not connected. Guests can still pay at the counter."}
          action={f.razorpayConfigured ? <Badge tone="fresh">Connected</Badge> : <Badge>Not connected</Badge>}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Key ID">
            <input value={rzp.keyId} onChange={(e) => setRzp({ ...rzp, keyId: e.target.value })} autoComplete="off" />
          </Field>
          <Field label="Key secret">
            <input type="password" value={rzp.keySecret} onChange={(e) => setRzp({ ...rzp, keySecret: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Webhook secret">
            <input type="password" value={rzp.webhookSecret} onChange={(e) => setRzp({ ...rzp, webhookSecret: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
      </Card>

      <div className="line sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border bg-(--surface)/90 p-3 shadow-lift backdrop-blur-xl">
        <Button type="submit">
          <Save className="h-4 w-4" aria-hidden />
          Save settings
        </Button>
        {msg && (
          <span className="flex items-center gap-1.5 text-sm font-semibold text-fresh">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {msg}
          </span>
        )}
        <div className="w-full empty:hidden">
          <ErrorText error={error} />
        </div>
      </div>
    </form>
  );
}
