"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DevicePairInput, HubPairInput, type DeviceKind } from "@rms/contracts";
import { ChefHat, ConciergeBell, MonitorSmartphone, ReceiptText, Router, Trash2, UserRoundCog, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, SelectField, orNull, useForm } from "@/components/ui";
import { Loadable, confirm, notify } from "@/components/ui/feedback";
import { CardSkeleton, ListSkeleton } from "@/components/ui/skeleton";

interface Device { id: string; name: string; kind: DeviceKind; stationId: string | null; lastSeenAt: string | null }
interface Station { id: string; name: string }

const KIND_LABEL: Record<DeviceKind, string> = { KDS: "Kitchen screen", WAITER: "Waiter phone", POS: "Counter", MANAGER: "Manager", HUB: "Local hub" };
const KIND_ICON: Record<DeviceKind, LucideIcon> = { KDS: ChefHat, WAITER: ConciergeBell, POS: ReceiptText, MANAGER: UserRoundCog, HUB: Router };
const PAIRABLE = ["KDS", "WAITER", "POS", "MANAGER"] as const;

/** Pair the device you're holding. After pairing, staff sign in here with PIN only. */
export function DevicesTab() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["admin", "devices"], queryFn: () => api<Device[]>("GET", "/v1/admin/devices") });
  const stations = useQuery({ queryKey: ["admin", "stations"], queryFn: () => api<Station[]>("GET", "/v1/admin/stations") });

  const form = useForm({
    initial: { name: "", kind: "KDS" as (typeof PAIRABLE)[number], stationId: "" },
    schema: DevicePairInput,
    build: (v) => ({ name: v.name.trim(), kind: v.kind, stationId: v.kind === "KDS" ? orNull(v.stationId) : null }),
  });
  const pair = form.submit(async (body) => {
    await api("POST", "/v1/auth/devices/pair", body);
    await signOut(); // hand the device over: next screen is the staff PIN picker
  });

  async function remove(d: Device) {
    if (!(await confirm({ title: `Remove ${d.name}?`, description: "Whoever is signed in there is signed out, and it needs pairing again.", confirmLabel: "Remove device", destructive: true })))
      return;
    try {
      await api("DELETE", `/v1/admin/devices/${d.id}`);
      notify.ok(`${d.name} removed`);
      void qc.invalidateQueries({ queryKey: ["admin", "devices"] });
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Pair this device" hint="Do this once on each tablet or phone. You'll be signed out and staff can then sign in with their PIN." />
        <form onSubmit={pair} className="grid gap-4 rounded-xl bg-(--sunken) p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-4 lg:items-start" noValidate>
          <Field label="Name" required error={form.error("name")}>
            <input {...form.text("name")} placeholder="Tandoor tablet" maxLength={40} />
          </Field>
          <Field label="Used as" required>
            <SelectField value={form.values.kind} onChange={(k) => form.set("kind", k as (typeof PAIRABLE)[number])} options={PAIRABLE.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
          </Field>
          {form.values.kind === "KDS" && (
            <Field label="Station" hint="Which tickets this screen shows">
              <SelectField value={form.values.stationId} onChange={(s) => form.set("stationId", s)} emptyLabel="All stations" options={(stations.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
          )}
          <Button type="submit" className="lg:mt-6.5" disabled={form.busy}>
            {form.busy ? "Pairing…" : "Pair"}
          </Button>
          {form.formError && (
            <div className="sm:col-span-2 lg:col-span-4">
              <FormError message={form.formError} />
            </div>
          )}
        </form>
      </Card>
      <HubCard />
      <Card>
        <CardHeader title="Paired devices" />
        <Loadable query={devices} skeleton={<ListSkeleton rows={3} cols={2} />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState icon={MonitorSmartphone} title="No devices paired yet" hint="Open this console on the kitchen tablet or a waiter's phone and pair it above." />
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {list.map((d) => {
                  const Icon = KIND_ICON[d.kind];
                  return (
                    <li key={d.id} className="line flex items-center gap-3 rounded-xl border p-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand">
                        <Icon className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{d.name}</span>
                        <span className="muted block truncate text-sm">
                          {KIND_LABEL[d.kind]}
                          {d.stationId ? ` · ${stations.data?.find((s) => s.id === d.stationId)?.name ?? ""}` : ""}
                          {d.lastSeenAt && ` · seen ${new Date(d.lastSeenAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`}
                        </span>
                      </span>
                      <Button variant="ghost" className="muted px-0 hover:text-late" aria-label={`Remove ${d.name}`} onClick={() => void remove(d)}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )
          }
        </Loadable>
      </Card>
    </div>
  );
}

interface HubInfo { url: string | null; deviceId: string | null; lastSeenAt: string | null }
interface HubPaired { token: string; url: string; cloudUrl: string }

/**
 * Local hub: a small always-on box (mini PC / Raspberry Pi) on the restaurant Wi-Fi.
 * When the internet drops, kitchen and waiter screens switch to it automatically and keep working.
 */
function HubCard() {
  const qc = useQueryClient();
  const hub = useQuery({ queryKey: ["admin", "hub"], queryFn: () => api<HubInfo>("GET", "/v1/admin/hub") });
  const [paired, setPaired] = useState<HubPaired | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", "hub"] });
  const online = hub.data?.lastSeenAt && Date.now() - new Date(hub.data.lastSeenAt).getTime() < 60_000;

  const form = useForm({ initial: { url: "" }, schema: HubPairInput, build: (v) => ({ url: v.url.trim() }) });
  const pair = form.submit(async (body) => {
    setPaired(await api<HubPaired>("POST", "/v1/admin/hub", body));
    form.reset();
    refresh();
  });

  async function remove() {
    if (!(await confirm({ title: "Remove the local hub?", description: "Screens will have no backup during internet outages.", confirmLabel: "Remove hub", destructive: true }))) return;
    try {
      await api("DELETE", "/v1/admin/hub");
      notify.ok("Local hub removed");
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  if (hub.isLoading) return <CardSkeleton lines={1} />;
  return (
    <Card>
      <CardHeader
        title="Local hub (internet backup)"
        hint="A small box on your Wi-Fi keeps the kitchen and waiters working when the internet is down, and sends everything to the cloud when it's back. Card and UPI payments and new QR orders still need the internet."
        action={hub.data?.deviceId && !paired ? <Badge tone={online ? "fresh" : "late"}>{online ? "Hub connected" : "Hub not reporting"}</Badge> : undefined}
      />
      {hub.data?.deviceId && !paired && (
        <p className="mb-4 flex flex-wrap items-center gap-x-2 text-sm">
          <span className="rounded-md bg-(--sunken) px-2 py-0.5 font-mono text-xs">{hub.data.url}</span>
          {hub.data.lastSeenAt && <span className="muted">last seen {new Date(hub.data.lastSeenAt).toLocaleTimeString()}</span>}
        </p>
      )}
      {paired ? (
        <div className="space-y-3 rounded-xl border border-warn/40 bg-warn/10 p-4 text-sm">
          <p className="font-semibold">Put these in the hub&apos;s .env file. The token is shown only once.</p>
          <pre className="surface line overflow-x-auto rounded-lg border p-2 font-mono text-xs">{`CLOUD_URL=${paired.cloudUrl}
HUB_TOKEN=${paired.token}`}</pre>
          <Button variant="outline" onClick={() => setPaired(null)}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={pair} className="flex flex-wrap items-start gap-2" noValidate>
          <Field label="Hub address on your Wi-Fi" required error={form.error("url")} hint="e.g. https://hub.yourrestaurant.in:4100" className="min-w-64 flex-1">
            <input {...form.text("url")} type="url" placeholder={hub.data?.url ?? "https://"} />
          </Field>
          <Button type="submit" className="mt-6.5" disabled={form.busy}>
            {hub.data?.deviceId ? "Replace hub" : "Set up hub"}
          </Button>
          {hub.data?.deviceId && (
            <Button type="button" variant="ghost" className="mt-6.5" onClick={() => void remove()}>
              Remove
            </Button>
          )}
          {form.formError && !form.error("url") && (
            <div className="w-full">
              <FormError message={form.formError} />
            </div>
          )}
        </form>
      )}
    </Card>
  );
}
