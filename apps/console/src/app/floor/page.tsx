"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FloorTable, FloorView } from "@rms/contracts";
import { api, rupees } from "@/lib/api";
import { useGuard } from "@/lib/auth";
import { chime, unlockSound, useStaffSocket } from "@/lib/realtime";
import { AlarmClock, BarChart3, Bell, CheckCircle2, Flame, HandHelping, Move, Settings2, Users } from "lucide-react";
import { Button, ErrorText, NavLink, OfflineBanner, TopBar } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_STYLE: Record<FloorTable["status"], string> = {
  FREE: "line",
  OCCUPIED: "border-brand/70",
  BILL_REQUESTED: "border-warn bg-warn/10",
  CLEANING: "border-stone-400 bg-stone-500/10",
  RESERVED: "border-blue-500/70",
};

type Pos = { x: number; y: number };

/** Tables nobody has placed yet get a tidy grid so a new floor is usable before anyone arranges it. */
function autoPos(i: number): Pos {
  return { x: 6 + (i % 6) * 15, y: 8 + Math.floor(i / 6) * 22 };
}

/** Manager's live floor: every table at a glance, overdue pickups on top. "Arrange" lets them drag tables into place. */
export default function FloorPage() {
  const me = useGuard(["OWNER", "MANAGER"]);
  const qc = useQueryClient();
  const floor = useQuery({
    queryKey: ["floor"],
    queryFn: () => api<FloorView>("GET", "/v1/s/floor"),
    enabled: Boolean(me),
    refetchInterval: 15_000,
  });
  const refetch = useCallback(() => void qc.invalidateQueries({ queryKey: ["floor"] }), [qc]);
  const { online } = useStaffSocket(Boolean(me), refetch, (s) => {
    s.on("pickup:escalated", () => (chime("alert"), refetch()));
    for (const ev of [
      "order:placed",
      "order:pending_confirmation",
      "item:status_changed",
      "request:created",
      "request:done",
      "bill:requested",
      "bill:paid",
      "bill:updated",
      "table:status_changed",
      "session:guest_joined",
    ] as const)
      s.on(ev, refetch);
  });

  const [floorId, setFloorId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [moved, setMoved] = useState<Record<string, Pos>>({});
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!me) return null;
  const data = floor.data;
  const floors = data?.floors ?? [];
  const current = floorId ?? floors[0]?.id ?? null;
  const tables = (data?.tables ?? []).filter((t) => !floors.length || t.floorId === current || (!t.floorId && current === floors[0]?.id));
  // kept inside the plan so a table saved at an edge (or with old grid-style numbers) is never cut off
  const inside = (p: Pos): Pos => ({ x: Math.min(93, Math.max(7, p.x)), y: Math.min(92, Math.max(8, p.y)) });
  const posOf = (t: FloorTable, i: number): Pos => inside(moved[t.id] ?? (t.posX !== null && t.posY !== null ? { x: t.posX, y: t.posY } : autoPos(i)));

  async function save() {
    setError(null);
    try {
      await api("PUT", "/v1/admin/tables/positions", {
        tables: Object.entries(moved).map(([id, p]) => ({
          id,
          posX: Math.round(p.x),
          posY: Math.round(p.y),
        })),
      });
      setMoved({});
      setEditing(false);
      refetch();
    } catch (e) {
      setError(e);
    }
  }

  const live = (data?.tables ?? []).filter((t) => t.session);
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar title="Floor" subtitle="Live view" online={online}>
        <NavLink href="/manage/" icon={Settings2}>
          Manage
        </NavLink>
        <NavLink href="/reports/" icon={BarChart3}>
          Reports
        </NavLink>
        <Button variant="ghost" className="px-0" onClick={() => (unlockSound(), chime())} aria-label="Turn on sound alerts" title="Turn on sound alerts">
          <Bell className="h-5 w-5" aria-hidden />
        </Button>
      </TopBar>
      <OfflineBanner online={online} />

      {data && data.escalations.length > 0 && (
        <section aria-label="Overdue pickups" className="space-y-1 bg-late px-4 py-2.5 text-white">
          {data.escalations.map((e) => (
            <p key={e.orderItemId} className="flex items-center gap-2 font-semibold">
              <AlarmClock className="h-4 w-4 shrink-0" aria-hidden />
              {e.itemName} for {e.tableLabel} ready {Math.round(e.waitingSec / 60)} min ago, not picked up
            </p>
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 px-3 py-3 text-sm sm:px-6">
        <div className={`scroll-x flex max-w-full gap-1 rounded-xl bg-(--sunken) p-1 ${floors.length > 1 ? "" : "hidden"}`}>
          {floors.map((f) => (
            <button
              key={f.id}
              onClick={() => setFloorId(f.id)}
              aria-current={current === f.id}
              className={`h-9 shrink-0 rounded-lg px-3.5 font-semibold whitespace-nowrap transition ${current === f.id ? "surface text-brand shadow-soft" : "muted hover:text-(--ink)"}`}
            >
              {f.name}
            </button>
          ))}
        </div>
        <span className="muted ml-auto flex items-center gap-3 font-medium">
          <span className="flex items-center gap-1">
            <Users className="h-4 w-4" aria-hidden />
            {live.length} occupied
          </span>
          <span className="font-bold text-(--ink) tabular-nums">{rupees(live.reduce((s, t) => s + (t.session?.due ?? 0), 0))} open</span>
        </span>
        {editing ? (
          <span className="flex gap-2">
            <Button disabled={!Object.keys(moved).length} onClick={() => void save()}>
              Save layout
            </Button>
            <Button variant="outline" onClick={() => (setMoved({}), setEditing(false))}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button variant="outline" className="text-sm" onClick={() => setEditing(true)}>
            <Move className="h-4 w-4" aria-hidden />
            Arrange tables
          </Button>
        )}
      </div>
      <div className="px-3 sm:px-6">
        <ErrorText error={error} />
      </div>

      {!data ? (
        <div className="mx-3 mb-4 flex-1 sm:mx-6" role="status" aria-label="Loading floor">
          <Skeleton className="h-full min-h-[70dvh] rounded-3xl" />
        </div>
      ) : (
        <Canvas editing={editing} onMove={(id, p) => setMoved((m) => ({ ...m, [id]: p }))}>
          {tables.map((t, i) => {
            const p = posOf(t, i);
            return (
              <div
                key={t.id}
                data-table-id={t.id}
                className={`surface absolute flex w-[13%] min-w-26 -translate-x-1/2 -translate-y-1/2 flex-col gap-0.5 rounded-2xl border-2 p-2.5 text-sm shadow-soft ${STATUS_STYLE[t.status]} ${editing ? "cursor-grab touch-none ring-2 ring-brand/20" : ""}`}
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
              >
                <span className="flex items-baseline justify-between">
                  <span className="text-lg font-extrabold">{t.label}</span>
                  <span className="muted text-xs font-medium">{t.seats} seats</span>
                </span>
                {t.session ? (
                  <>
                    <span className="muted flex items-center gap-1 text-xs">
                      <Users className="h-3 w-3" aria-hidden /> {t.session.guestCount} ·{" "}
                      {Math.max(0, Math.round((now - new Date(t.session.openedAt).getTime()) / 60_000))} min
                    </span>
                    <span className="font-bold tabular-nums">{rupees(t.session.due)}</span>
                    <span className="flex flex-wrap gap-1 text-xs">
                      {t.session.pendingConfirm && <Badge className="bg-warn/20">confirm</Badge>}
                      {t.session.cooking > 0 && (
                        <Badge className="bg-brand/15 text-brand">
                          <Flame className="h-3 w-3" aria-label="cooking" /> {t.session.cooking}
                        </Badge>
                      )}
                      {t.session.ready > 0 && (
                        <Badge className="bg-fresh/15 text-fresh">
                          <CheckCircle2 className="h-3 w-3" aria-label="ready" /> {t.session.ready}
                        </Badge>
                      )}
                      {t.session.openRequests > 0 && (
                        <Badge className="bg-late/15 text-late">
                          <HandHelping className="h-3 w-3" aria-label="requests" /> {t.session.openRequests}
                        </Badge>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="muted text-xs capitalize">{t.status.replace("_", " ").toLowerCase()}</span>
                )}
              </div>
            );
          })}
        </Canvas>
      )}
    </div>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-px font-semibold ${className}`}>{children}</span>;
}

/** Drag surface: positions are % of the canvas, so the layout fits any screen. */
function Canvas({ editing, onMove, children }: { editing: boolean; onMove: (id: string, p: Pos) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<string | null>(null);

  const toPos = (e: React.PointerEvent): Pos | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const clamp = (v: number) => Math.min(96, Math.max(4, v));
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 100),
      y: clamp(((e.clientY - r.top) / r.height) * 100),
    };
  };

  return (
    // On phones the plan keeps a readable size and scrolls sideways instead of squashing tables together.
    <div className="mx-3 mb-4 flex flex-1 overflow-x-auto sm:mx-6">
      <div
        ref={ref}
        className={`relative min-h-[70dvh] min-w-[760px] flex-1 rounded-3xl border-2 border-dashed bg-[radial-gradient(var(--line)_1px,transparent_1px)] bg-size-[22px_22px] ${editing ? "border-brand" : "line"}`}
        onPointerDown={(e) => {
          if (!editing) return;
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-table-id]");
          if (!el?.dataset.tableId) return;
          drag.current = el.dataset.tableId;
          ref.current?.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = toPos(e);
          if (p) onMove(drag.current, p);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {children}
      </div>
    </div>
  );
}
