"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HotelSettingsInput } from "@rms/contracts";
import { Save } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, Field, FormError, orNull, useForm } from "@/components/ui";
import { Loadable, notify } from "@/components/ui/feedback";
import { CardSkeleton } from "@/components/ui/skeleton";

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
  const s = useQuery({ queryKey: ["admin", "hotel"], queryFn: () => api<Settings>("GET", "/v1/admin/hotel") });
  return (
    <Loadable
      query={s}
      skeleton={
        <div className="space-y-6">
          <CardSkeleton lines={4} />
          <CardSkeleton lines={3} />
        </div>
      }
    >
      {(data) => <SettingsForm key={JSON.stringify(data)} settings={data} />}
    </Loadable>
  );
}

const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

function SettingsForm({ settings }: { settings: Settings }) {
  const qc = useQueryClient();
  const taxes = useQuery({ queryKey: ["admin", "taxes"], queryFn: () => api<Tax[]>("GET", "/v1/admin/taxes") });
  const form = useForm({
    initial: {
      name: settings.name,
      phone: settings.phone ?? "",
      address: settings.address ?? "",
      gstin: settings.gstin ?? "",
      invoicePrefix: settings.invoicePrefix,
      dayStartsAt: settings.dayStartsAt,
      serviceCharge: String(settings.serviceChargeBps / 100),
      readyPickupAlertSec: String(settings.readyPickupAlertSec),
      requireWaiterConfirm: settings.requireWaiterConfirm,
      allowPayLater: settings.allowPayLater,
      pricesIncludeTax: settings.pricesIncludeTax,
      "razorpay.keyId": "",
      "razorpay.keySecret": "",
      "razorpay.webhookSecret": "",
    },
    schema: HotelSettingsInput,
    build: (v) => {
      const rzp = { keyId: v["razorpay.keyId"].trim(), keySecret: v["razorpay.keySecret"].trim(), webhookSecret: v["razorpay.webhookSecret"].trim() };
      const sc = num(v.serviceCharge);
      return {
        name: v.name.trim(),
        phone: orNull(v.phone),
        address: orNull(v.address),
        gstin: orNull(v.gstin.toUpperCase()),
        invoicePrefix: v.invoicePrefix,
        dayStartsAt: v.dayStartsAt,
        serviceChargeBps: sc === undefined ? undefined : Math.round(sc * 100),
        readyPickupAlertSec: num(v.readyPickupAlertSec),
        requireWaiterConfirm: v.requireWaiterConfirm,
        allowPayLater: v.allowPayLater,
        pricesIncludeTax: v.pricesIncludeTax,
        // keys are all-or-nothing: typing one asks for the other two
        ...(rzp.keyId || rzp.keySecret || rzp.webhookSecret ? { razorpay: rzp } : {}),
      };
    },
  });
  const v = form.values;

  const save = form.submit(async (body) => {
    await api("PATCH", "/v1/admin/hotel", body);
    notify.ok("Settings saved");
    void qc.invalidateQueries({ queryKey: ["admin", "hotel"] });
  });

  const check = (k: "requireWaiterConfirm" | "allowPayLater" | "pricesIncludeTax", label: string, hint: string) => (
    <label className="line flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition has-checked:border-brand/40 has-checked:bg-brand/5">
      <input type="checkbox" className="mt-0.5" checked={v[k]} onChange={(e) => form.set(k, e.target.checked)} />
      <span>
        <span className="font-semibold">{label}</span>
        <span className="muted mt-0.5 block text-sm">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      <Card>
        <CardHeader title="Restaurant" hint="Shown on guest menus and printed on every GST bill." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required error={form.error("name")}>
            <input {...form.text("name")} maxLength={80} />
          </Field>
          <Field label="Phone" error={form.error("phone")}>
            <input {...form.text("phone")} type="tel" inputMode="tel" placeholder="98765 43210" />
          </Field>
          <Field label="Address" error={form.error("address")} className="sm:col-span-2">
            <input {...form.text("address")} maxLength={300} />
          </Field>
          <Field label="GSTIN" error={form.error("gstin")} hint="15 characters, printed on bills">
            <input {...form.text("gstin")} onChange={(e) => form.set("gstin", e.target.value.toUpperCase())} maxLength={15} placeholder="21ABCDE1234F1Z5" />
          </Field>
          <Field label="Invoice prefix" required error={form.error("invoicePrefix")} hint="Bill numbers look like INV/2627/00042">
            <input {...form.text("invoicePrefix")} onChange={(e) => form.set("invoicePrefix", e.target.value.toUpperCase())} maxLength={4} />
          </Field>
          <Field label="Business day starts at" required error={form.error("dayStartsAt")} hint="Order numbers reset at this time">
            <input {...form.text("dayStartsAt")} type="time" />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Ordering & billing" />
        <div className="space-y-3">
          {check("requireWaiterConfirm", "Waiter confirms first QR order", "Stops prank orders: the kitchen only sees a table's orders after a waiter confirms guests are seated.")}
          {check("allowPayLater", "Allow pay later", "Guests order now and pay at the end.")}
          {check("pricesIncludeTax", "Menu prices include GST", "Otherwise GST is added on the bill.")}
          <div className="grid gap-4 pt-1 sm:grid-cols-2">
            <Field label="Service charge %" required error={form.error("serviceChargeBps")} hint="0 to 20. Optional by law — guests can ask to remove it.">
              <input {...form.text("serviceCharge")} inputMode="decimal" />
            </Field>
            <Field label="Alert manager if food waits (seconds)" required error={form.error("readyPickupAlertSec")} hint="30 to 1800">
              <input {...form.text("readyPickupAlertSec")} inputMode="numeric" />
            </Field>
          </div>
          <p className="muted text-sm">Taxes: {taxes.data?.map((t) => `${t.name} ${t.rateBps / 100}%`).join(" + ") ?? "…"}</p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="UPI payments (Razorpay)"
          hint={settings.razorpayConfigured ? `Connected (${settings.razorpayKeyId}). Enter new keys only to replace them.` : "Not connected. Guests can still pay at the counter."}
          action={settings.razorpayConfigured ? <Badge tone="fresh">Connected</Badge> : <Badge>Not connected</Badge>}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Key ID" error={form.error("razorpay.keyId")}>
            <input {...form.text("razorpay.keyId")} autoComplete="off" placeholder="rzp_live_…" />
          </Field>
          <Field label="Key secret" error={form.error("razorpay.keySecret")}>
            <input {...form.text("razorpay.keySecret")} type="password" autoComplete="new-password" />
          </Field>
          <Field label="Webhook secret" error={form.error("razorpay.webhookSecret")}>
            <input {...form.text("razorpay.webhookSecret")} type="password" autoComplete="new-password" />
          </Field>
        </div>
      </Card>

      <div className="line sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border bg-(--surface)/90 p-3 shadow-lift backdrop-blur-xl">
        <Button type="submit" disabled={form.busy}>
          <Save className="h-4 w-4" aria-hidden />
          {form.busy ? "Saving…" : "Save settings"}
        </Button>
        <p className="muted hidden text-xs sm:block">
          Fields marked <span className="text-late">*</span> are required.
        </p>
        {form.formError && (
          <div className="w-full">
            <FormError message={form.formError} />
          </div>
        )}
      </div>
    </form>
  );
}
