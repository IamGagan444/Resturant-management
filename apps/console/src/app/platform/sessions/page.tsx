"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ResetPasswordInput, type PlatformHotel, type PlatformSession } from "@rms/contracts";
import { Globe, KeyRound, KeySquare, LogOut, MonitorSmartphone, RefreshCw, Search } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, EmptyState, Field, FormError, SelectField, useForm } from "@/components/ui";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { Loadable, confirm, notify } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";
import { ListSkeleton } from "@/components/ui/skeleton";
import { PageTitle, describeAgent, makePassword, timeAgo } from "@/components/platform/common";

const ROLE_LABEL: Record<string, string> = { OWNER: "Owner", MANAGER: "Manager", CASHIER: "Cashier", COOK: "Cook", WAITER: "Waiter" };

/** Super admin: who from each restaurant is signed in, where, and since when. Sign out one session or a person everywhere. */
export default function SessionsPage() {
  const qc = useQueryClient();
  const [hotelId, setHotelId] = useState("");
  const [q, setQ] = useState("");
  const [pwFor, setPwFor] = useState<PlatformSession["person"] | null>(null);

  // ?hotel=… when coming from a restaurant's menu (read once; static export has no server-side params)
  useEffect(() => {
    const h = new URLSearchParams(location.search).get("hotel");
    if (h) setHotelId(h);
  }, []);

  const hotels = useQuery({ queryKey: ["p", "hotels"], queryFn: () => api<PlatformHotel[]>("GET", "/v1/platform/hotels") });
  const sessions = useQuery({
    queryKey: ["p", "sessions", hotelId],
    queryFn: () => api<PlatformSession[]>("GET", `/v1/platform/sessions${hotelId ? `?hotelId=${hotelId}` : ""}`),
    refetchInterval: 30_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["p", "sessions"] });

  // one card per person, their sign-ins inside
  const people = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const by = new Map<string, { person: PlatformSession["person"]; hotel: PlatformSession["hotel"]; sessions: PlatformSession[] }>();
    for (const s of sessions.data ?? []) {
      if (needle && !`${s.person.name} ${s.person.email ?? ""} ${s.hotel.name}`.toLowerCase().includes(needle)) continue;
      const cur = by.get(s.person.id) ?? { person: s.person, hotel: s.hotel, sessions: [] };
      cur.sessions.push(s);
      by.set(s.person.id, cur);
    }
    // owners and managers first: they're the ones with web access
    const rank = (r: string) => (r === "OWNER" ? 0 : r === "MANAGER" ? 1 : 2);
    return [...by.values()].sort((a, b) => rank(a.person.role) - rank(b.person.role) || a.hotel.name.localeCompare(b.hotel.name));
  }, [sessions.data, q]);

  async function signOutOne(s: PlatformSession) {
    if (!(await confirm({ title: "Sign out this session?", description: `${s.person.name} on ${s.device ?? describeAgent(s.userAgent)} is signed out right away.`, confirmLabel: "Sign out" })))
      return;
    try {
      await api("DELETE", `/v1/platform/sessions/${s.id}`);
      notify.ok("Signed out");
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  async function signOutAll(p: PlatformSession["person"], count: number) {
    if (!(await confirm({ title: `Sign ${p.name} out everywhere?`, description: `All ${count} of their sign-ins end right away.`, confirmLabel: "Sign out everywhere", destructive: true })))
      return;
    try {
      await api("POST", `/v1/platform/staff/${p.id}/sign-out`);
      notify.ok(`${p.name} signed out everywhere`);
      refresh();
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <>
      <PageTitle
        title="Sessions"
        hint="Who is signed in, on which browser or device, and when they were last active."
        action={
          <Button variant="outline" onClick={refresh} disabled={sessions.isFetching}>
            <RefreshCw className={`h-4 w-4 ${sessions.isFetching ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person or restaurant" aria-label="Search sessions" className="w-full pl-9" />
        </div>
        <SelectField
          label="Restaurant"
          className="w-56"
          value={hotelId}
          onChange={setHotelId}
          emptyLabel="All restaurants"
          options={(hotels.data ?? []).map((h) => ({ value: h.id, label: h.name }))}
        />
      </div>

      <Loadable query={sessions} skeleton={<ListSkeleton rows={4} />}>
        {() =>
          people.length === 0 ? (
            <div className="surface line rounded-2xl border shadow-soft">
              <EmptyState icon={KeySquare} title="Nobody is signed in" hint={hotelId || q ? "Try another restaurant or search." : "Sign-ins appear here as owners and staff use the console."} />
            </div>
          ) : (
            <ul className="space-y-3">
              {people.map(({ person, hotel, sessions: list }) => (
                <li key={person.id} className="surface line rounded-2xl border shadow-soft">
                  <div className="flex items-center gap-3 p-4">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand/10 font-bold text-brand">{person.name.slice(0, 1).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{person.name}</span>
                        <Badge tone={person.role === "OWNER" ? "brand" : "neutral"}>{ROLE_LABEL[person.role] ?? person.role}</Badge>
                      </p>
                      <p className="muted truncate text-xs">
                        {hotel.name}
                        {person.email && ` · ${person.email}`}
                      </p>
                    </div>
                    <span className="muted hidden text-xs font-semibold sm:block">
                      {list.length} sign-in{list.length > 1 ? "s" : ""}
                    </span>
                    <RowActions label={`Actions for ${person.name}`}>
                      <DropdownMenuItem onSelect={() => void signOutAll(person, list.length)}>
                        <LogOut aria-hidden /> Sign out everywhere
                      </DropdownMenuItem>
                      {person.email && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => setPwFor(person)}>
                            <KeyRound aria-hidden /> Reset password
                          </DropdownMenuItem>
                        </>
                      )}
                    </RowActions>
                  </div>
                  <ul className="line divide-y divide-(--line) border-t">
                    {list.map((s) => (
                      <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-(--sunken) text-(--muted)">
                          {s.device ? <MonitorSmartphone className="h-4 w-4" aria-hidden /> : <Globe className="h-4 w-4" aria-hidden />}
                        </span>
                        <div className="min-w-0 flex-1 text-sm">
                          <p className="truncate font-medium">{s.device ? `${s.device} (paired device)` : describeAgent(s.userAgent)}</p>
                          <p className="muted truncate text-xs">
                            Active {timeAgo(s.lastActiveAt)}
                            {s.ip && ` · IP ${s.ip}`}
                            {s.device && s.userAgent && ` · ${describeAgent(s.userAgent)}`}
                          </p>
                        </div>
                        <Button variant="outline" className="h-9 min-h-9 shrink-0 px-3 text-xs" onClick={() => void signOutOne(s)}>
                          Sign out
                        </Button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )
        }
      </Loadable>

      {pwFor && <ResetPassword person={pwFor} onClose={() => setPwFor(null)} onDone={refresh} />}
    </>
  );
}

function ResetPassword({ person, onClose, onDone }: { person: PlatformSession["person"]; onClose: () => void; onDone: () => void }) {
  const [done, setDone] = useState<string | null>(null);
  const form = useForm({ initial: { password: makePassword() }, schema: ResetPasswordInput, build: (v) => ({ password: v.password }) });
  const save = form.submit(async (body) => {
    await api("POST", `/v1/platform/staff/${person.id}/password`, body);
    setDone(body.password);
    onDone();
  });
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reset password for ${person.name}`}
      description={person.email ?? undefined}
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
            <Button type="submit" form="reset-pw" className="flex-1 sm:flex-none" disabled={form.busy}>
              Set password
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-3 text-sm">
          <p>Done. They were signed out everywhere. Share the new password privately:</p>
          <p className="rounded-xl bg-(--sunken) px-4 py-3 text-center font-mono text-lg font-bold tracking-wider select-all">{done}</p>
        </div>
      ) : (
        <form id="reset-pw" onSubmit={save} className="space-y-4" noValidate>
          <Field label="New password" required error={form.error("password")} hint="At least 8 characters. They're signed out everywhere.">
            <div className="flex gap-2">
              <input {...form.text("password")} type="text" autoComplete="off" className="min-w-0 flex-1 font-mono" />
              <Button type="button" variant="outline" className="shrink-0 text-sm" onClick={() => form.set("password", makePassword())}>
                New
              </Button>
            </div>
          </Field>
          <FormError message={form.formError} />
        </form>
      )}
    </Modal>
  );
}
