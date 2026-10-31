"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { HotelStatus, ResetPasswordInput, UpdateHotelInput, type PlatformHotel } from "@rms/contracts";
import { Building2, CalendarClock, KeyRound, KeySquare, LogOut, Mail, Pencil, Rocket, Search, Settings2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, EmptyState, Field, FormError, LinkButton, SelectField, orNull, useForm } from "@/components/ui";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { Loadable, confirm, notify } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageTitle, STATUS_LABEL, STATUS_TONE, makePassword, shortDate } from "@/components/platform/common";

interface Plan { id: string; name: string; priceMonthly: number }
type Dialog = { kind: "details" | "plan" | "password"; hotel: PlatformHotel } | null;

/** Super admin: every restaurant on the platform; edit, change plan/status, help owners, delete. */
export default function RestaurantsPage() {
  const qc = useQueryClient();
  const hotels = useQuery({ queryKey: ["p", "hotels"], queryFn: () => api<PlatformHotel[]>("GET", "/v1/platform/hotels") });
  const plans = useQuery({ queryKey: ["p", "plans"], queryFn: () => api<Plan[]>("GET", "/v1/platform/plans") });
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<HotelStatus | "">("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["p"] });

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (hotels.data ?? []).filter(
      (h) =>
        (!status || h.status === status) &&
        (!needle || h.name.toLowerCase().includes(needle) || h.slug.includes(needle) || (h.owner?.email ?? "").toLowerCase().includes(needle)),
    );
  }, [hotels.data, q, status]);

  async function setHotelStatus(h: PlatformHotel, next: HotelStatus) {
    if (next === "SUSPENDED" || next === "CANCELLED") {
      const ok = await confirm({
        title: `${next === "SUSPENDED" ? "Suspend" : "Cancel"} ${h.name}?`,
        description: "Their staff are blocked on their next tap and guests can't order. You can reactivate any time.",
        confirmLabel: next === "SUSPENDED" ? "Suspend" : "Cancel restaurant",
        destructive: true,
      });
      if (!ok) return;
    }
    try {
      await api("PATCH", `/v1/platform/hotels/${h.id}`, { status: next });
      notify.ok(`${h.name} is now ${STATUS_LABEL[next].toLowerCase()}`);
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  async function signOutOwner(h: PlatformHotel) {
    if (!h.owner) return;
    if (!(await confirm({ title: `Sign ${h.owner.name} out everywhere?`, description: "Every browser and device they're signed in on is signed out right away.", confirmLabel: "Sign out" }))) return;
    try {
      const r = await api<{ sessions: number }>("POST", `/v1/platform/staff/${h.owner.id}/sign-out`);
      notify.ok(r.sessions ? `Signed out of ${r.sessions} session${r.sessions > 1 ? "s" : ""}` : "They weren't signed in anywhere");
    } catch (e) {
      notify.error(e);
    }
  }

  async function remove(h: PlatformHotel) {
    const ok = await confirm({
      title: `Delete ${h.name} permanently?`,
      description: "The menu, tables, staff, orders and bills are all deleted. This can't be undone. To keep their data, suspend or cancel instead.",
      confirmLabel: "Delete forever",
      destructive: true,
      typeToConfirm: h.name,
    });
    if (!ok) return;
    try {
      await api("DELETE", `/v1/platform/hotels/${h.id}`);
      notify.ok(`${h.name} deleted`);
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <>
      <PageTitle
        title="Restaurants"
        hint="Every restaurant on the platform. Use ⋯ on a row to edit, change plan, help the owner or remove it."
        action={
          <LinkButton href="/platform/onboard/" variant="primary">
            <Rocket className="h-4 w-4" aria-hidden />
            Onboard
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, URL or owner email" aria-label="Search restaurants" className="w-full pl-9" />
        </div>
        <SelectField
          label="Filter by status"
          className="w-44"
          value={status}
          onChange={(s) => setStatus(s as HotelStatus | "")}
          emptyLabel="All statuses"
          options={HotelStatus.options.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        />
      </div>

      <Loadable query={hotels} skeleton={<ListSkeleton rows={5} />}>
        {(all) =>
          all.length === 0 ? (
            <div className="surface line rounded-2xl border shadow-soft">
              <EmptyState icon={Building2} title="No restaurants yet" hint="Onboard the first one: it takes about a minute." />
            </div>
          ) : shown.length === 0 ? (
            <p className="muted py-10 text-center text-sm">No restaurant matches that search.</p>
          ) : (
            <ul className="space-y-2.5">
              {shown.map((h) => (
                <li key={h.id} className="surface line flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border p-4 shadow-soft">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/10 text-sm font-bold text-brand">{h.name.slice(0, 2).toUpperCase()}</span>
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{h.name}</span>
                      <Badge tone={STATUS_TONE[h.status]}>{STATUS_LABEL[h.status]}</Badge>
                      {h.plan && <Badge>{h.plan.name}</Badge>}
                    </p>
                    <p className="muted mt-0.5 truncate text-xs">
                      <span className="font-mono">/h/{h.slug}</span>
                      {h.owner && (
                        <>
                          {" · "}
                          {h.owner.name} · {h.owner.email}
                        </>
                      )}
                    </p>
                  </div>
                  <dl className="order-last grid w-full grid-cols-4 gap-2 text-center text-xs sm:order-none sm:w-auto sm:gap-5">
                    <div>
                      <dt className="muted">Tables</dt>
                      <dd className="text-sm font-bold tabular-nums">{h.tables}</dd>
                    </div>
                    <div>
                      <dt className="muted">Staff</dt>
                      <dd className="text-sm font-bold tabular-nums">{h.staff}</dd>
                    </div>
                    <div>
                      <dt className="muted">Orders 7d</dt>
                      <dd className="text-sm font-bold tabular-nums">{h.ordersLast7d}</dd>
                    </div>
                    <div>
                      <dt className="muted">{h.status === "TRIAL" ? "Trial ends" : "Since"}</dt>
                      <dd className="text-sm font-semibold">{h.status === "TRIAL" && h.trialEndsAt ? shortDate(h.trialEndsAt).replace(/ \d{4}$/, "") : shortDate(h.createdAt).replace(/ \d{4}$/, "")}</dd>
                    </div>
                  </dl>
                  <RowActions label={`Actions for ${h.name}`}>
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "details", hotel: h })}>
                      <Pencil aria-hidden /> Edit details
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "plan", hotel: h })}>
                      <Settings2 aria-hidden /> Plan, status &amp; trial
                    </DropdownMenuItem>
                    {h.status !== "ACTIVE" && (
                      <DropdownMenuItem onSelect={() => void setHotelStatus(h, "ACTIVE")}>
                        <CalendarClock aria-hidden /> Activate
                      </DropdownMenuItem>
                    )}
                    {h.status !== "SUSPENDED" && h.status !== "CANCELLED" && (
                      <DropdownMenuItem onSelect={() => void setHotelStatus(h, "SUSPENDED")}>
                        <CalendarClock aria-hidden /> Suspend
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Owner</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => (location.href = `/platform/sessions/?hotel=${h.id}`)}>
                      <KeySquare aria-hidden /> View sign-ins
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!h.owner?.email} onSelect={() => setDialog({ kind: "password", hotel: h })}>
                      <KeyRound aria-hidden /> Reset owner password
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!h.owner} onSelect={() => void signOutOwner(h)}>
                      <LogOut aria-hidden /> Sign owner out everywhere
                    </DropdownMenuItem>
                    {h.owner?.email && (
                      <DropdownMenuItem onSelect={() => (location.href = `mailto:${h.owner?.email}`)}>
                        <Mail aria-hidden /> Email owner
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => void remove(h)}>
                      <Trash2 aria-hidden /> Delete restaurant
                    </DropdownMenuItem>
                  </RowActions>
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>

      {dialog?.kind === "details" && <DetailsForm hotel={dialog.hotel} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === "plan" && <PlanForm hotel={dialog.hotel} plans={plans.data ?? []} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog?.kind === "password" && <OwnerPassword hotel={dialog.hotel} onClose={() => setDialog(null)} />}
    </>
  );
}

function DetailsForm({ hotel, onClose, onSaved }: { hotel: PlatformHotel; onClose: () => void; onSaved: () => void }) {
  const form = useForm({
    initial: { name: hotel.name, phone: hotel.phone ?? "", address: hotel.address ?? "", gstin: hotel.gstin ?? "" },
    schema: UpdateHotelInput,
    build: (v) => ({ name: v.name.trim(), phone: orNull(v.phone), address: orNull(v.address), gstin: orNull(v.gstin.toUpperCase()) }),
  });
  const save = form.submit(async (body) => {
    await api("PATCH", `/v1/platform/hotels/${hotel.id}`, body);
    notify.ok("Restaurant details saved");
    onSaved();
    onClose();
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${hotel.name}`}
      description={`Guest link: /h/${hotel.slug} (doesn't change, so printed QR codes keep working)`}
      footer={
        <>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="details-form" className="flex-1 sm:flex-none" disabled={form.busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="details-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
        <Field label="Restaurant name" required error={form.error("name")} className="sm:col-span-2">
          <input {...form.text("name")} maxLength={80} />
        </Field>
        <Field label="Phone" error={form.error("phone")}>
          <input {...form.text("phone")} type="tel" inputMode="tel" placeholder="98765 43210" />
        </Field>
        <Field label="GSTIN" error={form.error("gstin")}>
          <input {...form.text("gstin")} onChange={(e) => form.set("gstin", e.target.value.toUpperCase())} maxLength={15} placeholder="21ABCDE1234F1Z5" />
        </Field>
        <Field label="Address" error={form.error("address")} className="sm:col-span-2">
          <textarea {...form.text("address")} rows={2} maxLength={300} />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={form.formError} />
        </div>
      </form>
    </Modal>
  );
}

function PlanForm({ hotel, plans, onClose, onSaved }: { hotel: PlatformHotel; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const form = useForm({
    initial: { status: hotel.status, planId: hotel.plan?.id ?? "", trialEndsAt: hotel.trialEndsAt?.slice(0, 10) ?? "" },
    schema: UpdateHotelInput,
    build: (v) => ({
      status: v.status,
      planId: orNull(v.planId),
      trialEndsAt: v.trialEndsAt ? new Date(`${v.trialEndsAt}T23:59:59+05:30`).toISOString() : null,
    }),
  });
  const v = form.values;
  const save = form.submit(async (body) => {
    if (body.status === "TRIAL" && !body.trialEndsAt) return form.setFormError("Set when the trial ends.");
    await api("PATCH", `/v1/platform/hotels/${hotel.id}`, body);
    notify.ok(`${hotel.name} updated`);
    onSaved();
    onClose();
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Plan, status & trial"
      description={hotel.name}
      footer={
        <>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="plan-form" className="flex-1 sm:flex-none" disabled={form.busy}>
            Save
          </Button>
        </>
      }
    >
      <form id="plan-form" onSubmit={save} className="grid gap-4" noValidate>
        <Field label="Status" required hint={v.status === "SUSPENDED" || v.status === "CANCELLED" ? "Staff are blocked and guests can't order." : undefined}>
          <SelectField value={v.status} onChange={(s) => form.set("status", s as HotelStatus)} options={HotelStatus.options.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        </Field>
        <Field label="Plan">
          <SelectField value={v.planId} onChange={(p) => form.set("planId", p)} emptyLabel="No plan" options={plans.map((p) => ({ value: p.id, label: `${p.name} · ₹${p.priceMonthly / 100}/month` }))} />
        </Field>
        <Field label="Trial ends on" required={v.status === "TRIAL"} error={form.error("trialEndsAt")}>
          <input type="date" value={v.trialEndsAt} onChange={(e) => form.set("trialEndsAt", e.target.value)} />
        </Field>
        <FormError message={form.formError} />
      </form>
    </Modal>
  );
}

function OwnerPassword({ hotel, onClose }: { hotel: PlatformHotel; onClose: () => void }) {
  const [done, setDone] = useState<string | null>(null);
  const form = useForm({ initial: { password: "" }, schema: ResetPasswordInput, build: (v) => ({ password: v.password }) });
  const save = form.submit(async (body) => {
    await api("POST", `/v1/platform/staff/${hotel.owner!.id}/password`, body);
    setDone(body.password);
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reset owner password"
      description={`${hotel.owner?.name} · ${hotel.owner?.email}`}
      footer={
        done ? (
          <Button className="flex-1 sm:flex-none" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="pw-form" className="flex-1 sm:flex-none" disabled={form.busy}>
              Set password
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-3 text-sm">
          <p>Password changed and the owner was signed out everywhere. Share the new password with them privately:</p>
          <p className="rounded-xl bg-(--sunken) px-4 py-3 text-center font-mono text-lg font-bold tracking-wider select-all">{done}</p>
          <p className="muted">They can sign in at this console&apos;s /login page.</p>
        </div>
      ) : (
        <form id="pw-form" onSubmit={save} className="space-y-4" noValidate>
          <Field label="New password" required error={form.error("password")} hint="At least 8 characters">
            <div className="flex gap-2">
              <input {...form.text("password")} type="text" autoComplete="off" className="min-w-0 flex-1 font-mono" />
              <Button type="button" variant="outline" className="shrink-0 text-sm" onClick={() => form.set("password", makePassword())}>
                Generate
              </Button>
            </div>
          </Field>
          <FormError message={form.formError} />
        </form>
      )}
    </Modal>
  );
}
