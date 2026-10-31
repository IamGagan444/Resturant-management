"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResetPinInput, StaffCreateInput, StaffUpdateInput, type StaffRole } from "@rms/contracts";
import { KeyRound, Pencil, Phone, Power, UserPlus, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Field, FormError, SelectField, orNull, useForm } from "@/components/ui";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { Loadable, confirm, notify } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

interface Staff { id: string; name: string; role: StaffRole; phone: string | null; email: string | null; isActive: boolean; stationId: string | null }
interface Station { id: string; name: string }
interface Table { id: string; label: string; isActive: boolean }

const ROLES: { value: StaffRole; label: string; hint: string }[] = [
  { value: "WAITER", label: "Waiter", hint: "Takes orders, serves, handles requests" },
  { value: "COOK", label: "Cook", hint: "Uses the kitchen screen" },
  { value: "CASHIER", label: "Cashier", hint: "Collects payments at the counter" },
  { value: "MANAGER", label: "Manager", hint: "Everything except billing settings" },
  { value: "OWNER", label: "Owner", hint: "Full access" },
];
const roleLabel = (r: StaffRole) => ROLES.find((x) => x.value === r)?.label ?? r;
const isManagerRole = (r: string) => r === "MANAGER" || r === "OWNER";

export function StaffTab() {
  const qc = useQueryClient();
  const staff = useQuery({ queryKey: ["admin", "staff"], queryFn: () => api<Staff[]>("GET", "/v1/admin/staff") });
  const stations = useQuery({ queryKey: ["admin", "stations"], queryFn: () => api<Station[]>("GET", "/v1/admin/stations") });
  const [editing, setEditing] = useState<Staff | "new" | null>(null);
  const [pinFor, setPinFor] = useState<Staff | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin"] });
  const stationName = (id: string | null) => (id ? stations.data?.find((s) => s.id === id)?.name : undefined);

  async function toggleActive(s: Staff) {
    if (
      s.isActive &&
      !(await confirm({
        title: `Deactivate ${s.name}?`,
        description: "They can't sign in on any device until you activate them again. Their past orders stay in the records.",
        confirmLabel: "Deactivate",
        destructive: true,
      }))
    )
      return;
    try {
      await api("PATCH", `/v1/admin/staff/${s.id}`, { isActive: !s.isActive });
      notify.ok(s.isActive ? `${s.name} deactivated` : `${s.name} can sign in again`);
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Team"
          hint="Everyone signs in on shared devices with their own PIN."
          action={
            <Button onClick={() => setEditing("new")}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Add member
            </Button>
          }
        />
        <Loadable query={staff} skeleton={<ListSkeleton rows={4} cols={2} />}>
          {(list) =>
            list.length === 0 ? (
              <EmptyState icon={Users} title="No team members yet" hint="Add your waiters, cooks and cashiers. Each gets a PIN to sign in." />
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {list.map((s) => (
                  <li key={s.id} className={`line flex items-center gap-3 rounded-xl border p-3 ${s.isActive ? "" : "opacity-55"}`}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand/10 font-bold text-brand">{s.name.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{s.name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge>{roleLabel(s.role)}</Badge>
                        {stationName(s.stationId) && <Badge tone="brand">{stationName(s.stationId)}</Badge>}
                        {!s.isActive && <Badge tone="late">inactive</Badge>}
                        {s.phone && (
                          <span className="muted inline-flex items-center gap-1 text-xs">
                            <Phone className="h-3 w-3" aria-hidden />
                            {s.phone}
                          </span>
                        )}
                      </p>
                    </div>
                    <RowActions label={`Actions for ${s.name}`}>
                      <DropdownMenuItem onSelect={() => setEditing(s)}>
                        <Pencil aria-hidden /> Edit details
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setPinFor(s)}>
                        <KeyRound aria-hidden /> Reset PIN
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem destructive={s.isActive} onSelect={() => void toggleActive(s)}>
                        <Power aria-hidden /> {s.isActive ? "Deactivate" : "Activate"}
                      </DropdownMenuItem>
                    </RowActions>
                  </li>
                ))}
              </ul>
            )
          }
        </Loadable>
      </Card>

      <Assignments staff={staff.data ?? []} />

      {editing && (
        <StaffForm
          key={editing === "new" ? "new" : editing.id}
          person={editing === "new" ? null : editing}
          stations={stations.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {pinFor && <ResetPin person={pinFor} onClose={() => setPinFor(null)} />}
    </div>
  );
}

/** Add or edit a team member. PIN is only asked when adding; email + password only for managers and owners. */
function StaffForm({ person, stations, onClose, onSaved }: { person: Staff | null; stations: Station[]; onClose: () => void; onSaved: () => void }) {
  const adding = !person;
  const form = useForm({
    initial: { name: person?.name ?? "", role: person?.role ?? "WAITER", pin: "", phone: person?.phone ?? "", stationId: person?.stationId ?? "", email: person?.email ?? "", password: "" },
    schema: adding ? StaffCreateInput : StaffUpdateInput,
    build: (v) => {
      const mgr = isManagerRole(v.role);
      return {
        name: v.name,
        role: v.role,
        ...(adding && { pin: v.pin }),
        phone: orNull(v.phone),
        stationId: v.role === "COOK" ? orNull(v.stationId) : null,
        email: mgr ? orNull(v.email) : null,
        // editing: an empty password keeps the current one
        ...(mgr && v.password ? { password: v.password } : adding ? { password: null } : {}),
      };
    },
  });
  const v = form.values;
  const mgr = isManagerRole(v.role);

  const save = form.submit(async (body) => {
    if (adding) await api("POST", "/v1/admin/staff", body);
    else await api("PATCH", `/v1/admin/staff/${person.id}`, body);
    notify.ok(adding ? `${v.name.trim()} added. They can sign in with their PIN.` : "Saved");
    onSaved();
  });

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={adding ? "Add a team member" : `Edit ${person.name}`}
      description={adding ? "They sign in on paired devices by tapping their name and typing this PIN." : undefined}
      footer={
        <>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="staff-form" className="flex-1 sm:flex-none" disabled={form.busy}>
            {form.busy ? "Saving…" : adding ? "Add member" : "Save"}
          </Button>
        </>
      }
    >
      <form id="staff-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Name" required error={form.error("name")} className="sm:col-span-2">
          <input {...form.text("name")} autoComplete="off" maxLength={60} placeholder="e.g. Jeevan" />
        </Field>
        <Field label="Role" required error={form.error("role")} hint={ROLES.find((r) => r.value === v.role)?.hint}>
          <SelectField value={v.role} onChange={(r) => form.set("role", r as StaffRole)} options={ROLES} invalid={Boolean(form.error("role"))} />
        </Field>
        {adding ? (
          <Field label="PIN" required error={form.error("pin")} hint="4–6 digits, used to sign in">
            <input {...form.text("pin")} onChange={(e) => form.set("pin", e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="off" placeholder="••••" />
          </Field>
        ) : (
          <Field label="Mobile" error={form.error("phone")}>
            <input {...form.text("phone")} type="tel" inputMode="tel" placeholder="98765 43210" />
          </Field>
        )}
        {adding && (
          <Field label="Mobile" error={form.error("phone")} hint="Optional" className="sm:col-span-2">
            <input {...form.text("phone")} type="tel" inputMode="tel" placeholder="98765 43210" />
          </Field>
        )}
        {v.role === "COOK" && (
          <Field label="Kitchen station" error={form.error("stationId")} hint="Which tickets their kitchen screen shows" className="sm:col-span-2">
            <SelectField value={v.stationId} onChange={(s) => form.set("stationId", s)} emptyLabel="All stations" options={stations.map((s) => ({ value: s.id, label: s.name }))} />
          </Field>
        )}
        {mgr && (
          <>
            <Field label="Email (web sign-in)" error={form.error("email")} hint="To sign in on this console from any browser">
              <input {...form.text("email")} type="email" autoComplete="off" placeholder="name@example.com" />
            </Field>
            <Field label={adding ? "Password" : "New password"} error={form.error("password")} hint={adding ? "At least 8 characters" : "Leave empty to keep the current one"}>
              <input {...form.text("password")} type="password" autoComplete="new-password" />
            </Field>
          </>
        )}
        <div className="sm:col-span-2">
          <FormError message={form.formError} />
        </div>
      </form>
    </Modal>
  );
}

function ResetPin({ person, onClose }: { person: Staff; onClose: () => void }) {
  const form = useForm({ initial: { pin: "" }, schema: ResetPinInput, build: (v) => v });
  const save = form.submit(async (body) => {
    await api("POST", `/v1/admin/staff/${person.id}/reset-pin`, body);
    notify.ok(`New PIN set for ${person.name}`);
    onClose();
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reset PIN for ${person.name}`}
      description="Tell them the new PIN. The old one stops working right away."
      footer={
        <>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="pin-form" className="flex-1 sm:flex-none" disabled={form.busy}>
            Set PIN
          </Button>
        </>
      }
    >
      <form id="pin-form" onSubmit={save} className="space-y-4" noValidate>
        <Field label="New PIN" required error={form.error("pin")} hint="4–6 digits">
          <input
            {...form.text("pin")}
            onChange={(e) => form.set("pin", e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            className="text-center text-2xl font-bold tracking-[0.5em]"
          />
        </Field>
        <FormError message={form.formError} />
      </form>
    </Modal>
  );
}

/** Today's table → waiter map. Unassigned tables alert every waiter. */
function Assignments({ staff }: { staff: Staff[] }) {
  const tables = useQuery({ queryKey: ["admin", "tables"], queryFn: () => api<Table[]>("GET", "/v1/admin/tables") });
  const current = useQuery({ queryKey: ["admin", "assignments"], queryFn: () => api<{ tableId: string; staffId: string }[]>("GET", "/v1/admin/assignments") });
  const [map, setMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const waiters = staff.filter((s) => s.role === "WAITER" && s.isActive);

  useEffect(() => {
    if (current.data) setMap(Object.fromEntries(current.data.map((a) => [a.tableId, a.staffId])));
  }, [current.data]);

  async function save() {
    setBusy(true);
    try {
      // No date → server uses the hotel's business day (handles after-midnight shifts).
      await api("PUT", "/v1/admin/assignments", {
        assignments: Object.entries(map)
          .filter(([, s]) => s)
          .map(([tableId, staffId]) => ({ tableId, staffId })),
      });
      notify.ok("Today's assignments saved");
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Today's table assignments"
        hint="Unassigned tables alert every waiter."
        action={
          <Button variant="outline" onClick={() => void save()} disabled={busy || !tables.data?.length}>
            {busy ? "Saving…" : "Save assignments"}
          </Button>
        }
      />
      <Loadable
        query={tables}
        skeleton={
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-11 rounded-xl" />
            ))}
          </div>
        }
      >
        {(list) =>
          list.filter((t) => t.isActive).length === 0 ? (
            <p className="muted text-sm">Add tables first (Tables &amp; QR).</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list
                .filter((t) => t.isActive)
                .map((t) => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="grid h-11 min-w-12 shrink-0 place-items-center rounded-xl bg-(--sunken) px-2 font-bold">{t.label}</span>
                    <SelectField
                      label={`Waiter for ${t.label}`}
                      value={map[t.id] ?? ""}
                      onChange={(id) => setMap((m) => ({ ...m, [t.id]: id }))}
                      emptyLabel="Any waiter"
                      options={waiters.map((w) => ({ value: w.id, label: w.name }))}
                    />
                  </div>
                ))}
            </div>
          )
        }
      </Loadable>
    </Card>
  );
}
