"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StaffRole } from "@rms/contracts";
import { api } from "@/lib/api";
import { KeyRound, UserPlus } from "lucide-react";
import { Badge, Button, Card, CardHeader, ErrorText, Field } from "@/components/ui";

interface Staff { id: string; name: string; role: StaffRole; phone: string | null; email: string | null; isActive: boolean; stationId: string | null }
interface Station { id: string; name: string }
interface Table { id: string; label: string; isActive: boolean }

const ROLES: StaffRole[] = ["WAITER", "COOK", "CASHIER", "MANAGER", "OWNER"];

export function StaffTab() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ["admin", "staff"], queryFn: () => api<Staff[]>("GET", "/v1/admin/staff") });
  const stations = useQuery({ queryKey: ["admin", "stations"], queryFn: () => api<Station[]>("GET", "/v1/admin/stations") });
  const [f, setF] = useState({ name: "", role: "WAITER" as StaffRole, phone: "", pin: "", stationId: "", email: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const isMgr = f.role === "MANAGER" || f.role === "OWNER";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("POST", "/v1/admin/staff", {
        name: f.name,
        role: f.role,
        pin: f.pin,
        phone: f.phone || null,
        stationId: f.role === "COOK" && f.stationId ? f.stationId : null,
        email: isMgr && f.email ? f.email : null,
        password: isMgr && f.password ? f.password : null,
      });
      setF({ ...f, name: "", phone: "", pin: "", email: "", password: "" });
      refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Team" hint="Everyone signs in on shared devices with their own PIN." />
        <ul className="mb-6 grid gap-2 md:grid-cols-2">
          {staff.data?.map((s) => (
            <li key={s.id} className={`line flex flex-wrap items-center gap-3 rounded-xl border p-3 ${s.isActive ? "" : "opacity-50"}`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/10 font-bold text-brand">{s.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{s.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <Badge className="capitalize">{s.role.toLowerCase()}</Badge>
                  {s.stationId && <span className="muted truncate text-xs">{stations.data?.find((x) => x.id === s.stationId)?.name ?? ""}</span>}
                </span>
              </span>
              <Button
                variant="outline"
                className="px-3 text-sm"
                onClick={() => {
                  const pin = prompt(`New PIN for ${s.name} (4–6 digits)`);
                  if (pin) api("POST", `/v1/admin/staff/${s.id}/reset-pin`, { pin }).then(refresh, setError);
                }}
              >
                <KeyRound className="h-4 w-4" aria-hidden />
                Reset PIN
              </Button>
              <Button variant="ghost" className="px-3 text-sm" onClick={() => api("PATCH", `/v1/admin/staff/${s.id}`, { isActive: !s.isActive }).then(refresh, setError)}>
                {s.isActive ? "Deactivate" : "Activate"}
              </Button>
            </li>
          ))}
        </ul>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
          <UserPlus className="h-4 w-4 text-brand" aria-hidden />
          Add a team member
        </h3>
        <form onSubmit={add} className="grid gap-3 rounded-xl bg-(--sunken) p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
          <Field label="Name">
            <input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Role">
            <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as StaffRole })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="PIN (4–6 digits)">
            <input required inputMode="numeric" pattern="\d{4,6}" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label="Phone">
            <input inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
          {f.role === "COOK" && (
            <Field label="Station">
              <select value={f.stationId} onChange={(e) => setF({ ...f, stationId: e.target.value })}>
                <option value="">All</option>
                {stations.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {isMgr && (
            <>
              <Field label="Email (web login)">
                <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
              </Field>
              <Field label="Password">
                <input type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
              </Field>
            </>
          )}
          <Button type="submit" className="self-end">
            Add staff
          </Button>
        </form>
        <ErrorText error={error} />
      </Card>
      <Assignments staff={staff.data ?? []} />
    </div>
  );
}

/** Today's table → waiter map. Unassigned tables alert every waiter. */
function Assignments({ staff }: { staff: Staff[] }) {
  const tables = useQuery({ queryKey: ["admin", "tables"], queryFn: () => api<Table[]>("GET", "/v1/admin/tables") });
  const current = useQuery({ queryKey: ["admin", "assignments"], queryFn: () => api<{ tableId: string; staffId: string }[]>("GET", "/v1/admin/assignments") });
  const [map, setMap] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const waiters = staff.filter((s) => s.role === "WAITER" && s.isActive);

  useEffect(() => {
    if (current.data) setMap(Object.fromEntries(current.data.map((a) => [a.tableId, a.staffId])));
  }, [current.data]);

  async function save() {
    try {
      // No date → server uses the hotel's business day (handles after-midnight shifts).
      await api("PUT", "/v1/admin/assignments", {
        assignments: Object.entries(map)
          .filter(([, s]) => s)
          .map(([tableId, staffId]) => ({ tableId, staffId })),
      });
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card>
      <CardHeader title="Today's table assignments" hint="Unassigned tables alert every waiter." />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tables.data
          ?.filter((t) => t.isActive)
          .map((t) => (
            <label key={t.id} className="flex items-center gap-2">
              <span className="grid h-11 min-w-12 shrink-0 place-items-center rounded-xl bg-(--sunken) px-2 font-bold">{t.label}</span>
              <select className="min-w-0 flex-1" value={map[t.id] ?? ""} onChange={(e) => (setSaved(false), setMap({ ...map, [t.id]: e.target.value }))}>
                <option value="">Any waiter</option>
                {waiters.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
      </div>
      <Button className="mt-4" onClick={() => void save()}>
        {saved ? "Saved ✓" : "Save assignments"}
      </Button>
      <ErrorText error={error} />
    </Card>
  );
}
