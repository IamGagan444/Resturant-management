"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { DeviceKind } from "@rms/contracts";
import { api } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { Button, Card, ErrorText, Field } from "@/components/ui";

interface Device { id: string; name: string; kind: DeviceKind; stationId: string | null; lastSeenAt: string | null }
interface Station { id: string; name: string }

const KIND_LABEL: Record<DeviceKind, string> = { KDS: "Kitchen screen", WAITER: "Waiter phone", POS: "Counter", MANAGER: "Manager", HUB: "Local hub" };
const PAIRABLE = ["KDS", "WAITER", "POS", "MANAGER"] as const;

/** Pair the device you're holding. After pairing, staff sign in here with PIN only. */
export function DevicesTab() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ["admin", "devices"], queryFn: () => api<Device[]>("GET", "/v1/admin/devices") });
  const stations = useQuery({ queryKey: ["admin", "stations"], queryFn: () => api<Station[]>("GET", "/v1/admin/stations") });
  const [name, setName] = useState("");
  const [kind, setKind] = useState<DeviceKind>("KDS");
  const [stationId, setStationId] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function pair(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("POST", "/v1/auth/devices/pair", { name, kind, stationId: kind === "KDS" && stationId ? stationId : null });
      await signOut(); // hand the device over: next screen is the staff PIN picker
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-1 text-lg font-bold">Pair this device</h2>
        <p className="muted mb-3 text-sm">Do this once on each tablet or phone. You&apos;ll be signed out and staff can then sign in with their PIN.</p>
        <form onSubmit={pair} className="grid gap-3 sm:grid-cols-4">
          <Field label="Name">
            <input required placeholder="Tandoor tablet" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Used as">
            <select value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
              {PAIRABLE.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          {kind === "KDS" && (
            <Field label="Station">
              <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
                <option value="">All stations</option>
                {stations.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Button type="submit" className="self-end">
            Pair
          </Button>
        </form>
        <ErrorText error={error} />
      </Card>
      <HubCard />
      <Card>
        <h2 className="mb-3 text-lg font-bold">Paired devices</h2>
        <ul className="line divide-y divide-(--line) rounded-xl border">
          {devices.data?.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
              <span className="flex-1 font-semibold">{d.name}</span>
              <span className="muted text-sm">
                {KIND_LABEL[d.kind]}
                {d.stationId ? ` · ${stations.data?.find((s) => s.id === d.stationId)?.name ?? ""}` : ""}
              </span>
              <Button
                variant="ghost"
                onClick={() => confirm(`Remove ${d.name}? It will need pairing again.`) && api("DELETE", `/v1/admin/devices/${d.id}`).then(() => qc.invalidateQueries({ queryKey: ["admin", "devices"] }), setError)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
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
  const [url, setUrl] = useState("");
  const [paired, setPaired] = useState<HubPaired | null>(null);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin", "hub"] });
  const online = hub.data?.lastSeenAt && Date.now() - new Date(hub.data.lastSeenAt).getTime() < 60_000;

  async function pair(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      setPaired(await api<HubPaired>("POST", "/v1/admin/hub", { url: url.trim() }));
      refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-bold">Local hub (internet backup)</h2>
      <p className="muted mb-3 text-sm">
        A small box on your Wi-Fi keeps the kitchen and waiters working when the internet is down, and sends everything to the cloud when it&apos;s back.
        Card and UPI payments and new QR orders still need the internet.
      </p>
      {hub.data?.deviceId && !paired && (
        <p className="mb-3 text-sm">
          <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${online ? "bg-fresh" : "bg-late"}`} aria-hidden />
          {online ? "Hub connected" : "Hub not reporting"} · <span className="font-mono">{hub.data.url}</span>
          {hub.data.lastSeenAt && <span className="muted"> · last seen {new Date(hub.data.lastSeenAt).toLocaleTimeString()}</span>}
        </p>
      )}
      {paired ? (
        <div className="space-y-2 rounded-xl bg-warn/10 p-3 text-sm">
          <p className="font-semibold">Put these in the hub&apos;s .env file. The token is shown only once.</p>
          <pre className="surface line overflow-x-auto rounded-lg border p-2 font-mono text-xs">{`CLOUD_URL=${paired.cloudUrl}
HUB_TOKEN=${paired.token}`}</pre>
          <Button variant="outline" onClick={() => setPaired(null)}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={pair} className="flex flex-wrap items-end gap-2">
          <Field label="Hub address on your Wi-Fi" hint="e.g. https://hub.yourrestaurant.in:4100">
            <input required type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={hub.data?.url ?? "https://"} />
          </Field>
          <Button type="submit">{hub.data?.deviceId ? "Replace hub" : "Set up hub"}</Button>
          {hub.data?.deviceId && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => confirm("Remove the local hub? Screens will have no backup during outages.") && api("DELETE", "/v1/admin/hub").then(refresh, setError)}
            >
              Remove
            </Button>
          )}
        </form>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
