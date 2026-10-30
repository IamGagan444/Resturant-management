"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Card, ErrorText, Field } from "@/components/ui";

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
  if (!f) return null;

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
    <label className="flex items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
      <span>
        <span className="font-medium">{label}</span>
        <span className="muted block text-xs">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <h2 className="mb-3 text-lg font-bold">Restaurant</h2>
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
        <h2 className="mb-3 text-lg font-bold">Ordering & billing</h2>
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
        <h2 className="mb-1 text-lg font-bold">UPI payments (Razorpay)</h2>
        <p className="muted mb-3 text-sm">
          {f.razorpayConfigured ? `Connected (${f.razorpayKeyId}). Enter new keys only to replace them.` : "Not connected. Guests can still pay at the counter."}
        </p>
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

      <ErrorText error={error} />
      {msg && <p className="text-fresh">{msg}</p>}
      <Button type="submit">Save settings</Button>
    </form>
  );
}
