"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BoardTable, OrderItemView, PublicMenu, RequestType, WaiterBoard } from "@rms/contracts";
import { priceLine, type PricingAddonGroup } from "@rms/domain";
import { api, newClientId, newOrderedId, remembered, rupees } from "@/lib/api";
import { afterSending, send } from "@/lib/outbox";
import { unlockOnFirstTap, useRinger } from "@/lib/ringer";
import { RingBanner } from "@/components/RingBanner";
import { useGuard } from "@/lib/auth";
import { buzz, chime, unlockSound, useStaffSocket } from "@/lib/realtime";
import {
  AlarmClock,
  Bell,
  BellRing,
  Check,
  GlassWater,
  HandPlatter,
  HelpCircle,
  Plus,
  ReceiptText,
  Search,
  Users,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button, EmptyState, OfflineBanner, RejectionToast, TopBar } from "@/components/ui";
import { notify } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet } from "@/components/Sheet";

type Board = WaiterBoard;

const REQ_ICON: Record<RequestType, LucideIcon> = {
  CALL_WAITER: BellRing,
  WATER: GlassWater,
  CUTLERY: UtensilsCrossed,
  BILL: ReceiptText,
  OTHER: HelpCircle,
};
const TABLE_STYLE: Record<string, string> = {
  FREE: "line",
  OCCUPIED: "border-brand/60 bg-brand/5",
  BILL_REQUESTED: "border-warn bg-warn/10",
  CLEANING: "border-stone-400 bg-stone-500/10",
  RESERVED: "border-blue-500/60 bg-blue-500/5",
};

/** Waiter phone: everything needing action, top to bottom by urgency. Every action is one tap. */
export default function WaiterPage() {
  const me = useGuard(["WAITER", "MANAGER", "OWNER"]);
  const qc = useQueryClient();
  const [alerts, setAlerts] = useState(false);
  const [orderFor, setOrderFor] = useState<BoardTable | null>(null);
  const [swapFor, setSwapFor] = useState<OrderItemView | null>(null);
  const [escalation, setEscalation] = useState<string | null>(null);

  const board = useQuery({
    queryKey: ["board"],
    queryFn: () => remembered("board", () => api<Board>("GET", "/v1/s/waiter/board")),
    enabled: Boolean(me),
    refetchInterval: 30_000,
  });
  // after this phone's own taps have reached the server, so a live update can't flash them back
  const refetch = useCallback(() => afterSending(() => void qc.invalidateQueries({ queryKey: ["board"] })), [qc]);
  const alert = () => {
    chime("alert");
    buzz();
  };

  const { online } = useStaffSocket(Boolean(me), refetch, (s) => {
    s.on("item:status_changed", (e) => {
      if (e.to === "READY") alert();
      refetch();
    });
    s.on("request:created", () => (alert(), refetch()));
    s.on("order:pending_confirmation", () => (alert(), refetch()));
    s.on("bill:requested", () => (alert(), refetch()));
    s.on("pickup:escalated", (e) => {
      alert();
      setEscalation(`${e.itemName} for ${e.tableLabel} waiting ${Math.round(e.waitingSec / 60)} min`);
      refetch();
    });
    for (const ev of ["session:guest_joined", "order:placed", "request:done", "bill:paid", "table:status_changed", "item:out_of_stock"] as const)
      s.on(ev, refetch);
  });

  const act = (p: Promise<unknown>) => void p.catch(notify.error).finally(refetch);
  /** Optimistic board change; the queue delivers the command now or after an outage. */
  const patch = (fn: (b: Board) => Board) => qc.setQueryData<Board>(["board"], (b) => (b ? fn(b) : b));
  const queue = (p: Promise<void>) => void p.catch(refetch);
  const move = (id: string, to: "PICKED_UP" | "SERVED") => {
    patch((b) => ({
      ...b,
      ready: to === "SERVED" ? b.ready.filter((i) => i.id !== id) : b.ready.map((i) => (i.id === id ? { ...i, status: to } : i)),
    }));
    queue(send({ type: "item.transition", orderItemId: id, to }));
  };
  const handle = (id: string, done: boolean) => {
    patch((b) => ({
      ...b,
      requests: done ? b.requests.filter((r) => r.id !== id) : b.requests.map((r) => (r.id === id ? { ...r, status: "ACKNOWLEDGED" } : r)),
    }));
    queue(send(done ? { type: "request.done", requestId: id } : { type: "request.ack", requestId: id }));
  };

  // Rings until someone acts: food waiting to be picked up, a guest calling, or a new order to confirm.
  const bd = board.data;
  const waitingFood = bd?.ready.filter((i) => i.status === "READY") ?? [];
  const openRequests = bd?.requests.filter((r) => r.status === "OPEN") ?? [];
  const toConfirm = bd?.pendingOrders ?? [];
  const ringKey = [...waitingFood.map((i) => i.id), ...openRequests.map((r) => r.id), ...toConfirm.map((o) => o.id)].sort().join();
  const ringer = useRinger(ringKey !== "", ringKey);
  const ringLabel = [
    waitingFood.length && `${waitingFood.length} dish${waitingFood.length > 1 ? "es" : ""} ready to pick up`,
    openRequests.length && `${openRequests.length} guest request${openRequests.length > 1 ? "s" : ""}`,
    toConfirm.length && `${toConfirm.length} new order${toConfirm.length > 1 ? "s" : ""} to confirm`,
  ]
    .filter(Boolean)
    .join(" · ");
  useEffect(() => unlockOnFirstTap(), []);

  if (!me) return null;
  const b = board.data;

  return (
    <div className="min-h-dvh pb-12">
      <TopBar title="Floor" online={online}>
        {!alerts && (
          <Button variant="outline" className="text-sm" onClick={() => (unlockSound(), setAlerts(true), chime())}>
            <Bell className="h-4 w-4" aria-hidden />
            Alerts on
          </Button>
        )}
      </TopBar>
      <OfflineBanner online={online} />
      <RingBanner ringing={ringer.ringing} label={ringLabel} onSnooze={() => ringer.snooze()} />
      <RejectionToast />
      {escalation && (
        <button className="flex w-full items-center gap-2 bg-late px-4 py-3 text-left font-semibold text-white" onClick={() => setEscalation(null)}>
          <AlarmClock className="h-5 w-5 shrink-0" aria-hidden />
          {escalation} — tap to dismiss
        </button>
      )}

      {!b && (
        <div className="mx-auto max-w-3xl space-y-3 px-3 py-5 sm:px-6" role="status" aria-label="Loading">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <div className="grid grid-cols-2 gap-2.5 min-[420px]:grid-cols-3 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        </div>
      )}
      {b && (
        <div className="mx-auto max-w-3xl space-y-7 px-3 py-5 sm:px-6">
          {b.ready.length === 0 && b.requests.length === 0 && b.pendingOrders.length === 0 && (
            <div className="surface line rounded-2xl border shadow-soft">
              <EmptyState icon={HandPlatter} title="All caught up" hint="Ready dishes, guest requests and new orders show up here with an alert." />
            </div>
          )}
          {b.ready.length > 0 && (
            <Section title="Pick up" count={b.ready.length}>
              {b.ready.map((i) => (
                <div
                  key={i.id}
                  className={`surface flex items-center gap-3 rounded-2xl border p-3 shadow-soft ${i.status === "OUT_OF_STOCK" ? "border-late/60" : "border-fresh/60"}`}
                >
                  <span
                    className={`grid h-12 min-w-12 shrink-0 place-items-center rounded-xl px-2 text-lg font-extrabold ${i.status === "OUT_OF_STOCK" ? "bg-late/12 text-late" : "bg-fresh/12 text-fresh"}`}
                  >
                    {b.tables.find((t) => t.session?.id === i.sessionId)?.label ?? "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {i.quantity} × {i.name}
                      {i.variantName ? ` (${i.variantName})` : ""}
                    </p>
                    {i.status === "OUT_OF_STOCK" && <p className="text-sm font-medium text-late">Out of stock — ask the guest what they&apos;d like instead</p>}
                  </div>
                  {i.status === "READY" && (
                    <Button variant="success" onClick={() => move(i.id, "PICKED_UP")}>
                      Picked up
                    </Button>
                  )}
                  {i.status === "PICKED_UP" && <Button onClick={() => move(i.id, "SERVED")}>Served</Button>}
                  {i.status === "OUT_OF_STOCK" && <Button onClick={() => setSwapFor(i)}>Swap</Button>}
                </div>
              ))}
            </Section>
          )}

          {b.requests.length > 0 && (
            <Section title="Requests" count={b.requests.length}>
              {b.requests.map((r) => {
                const Icon = REQ_ICON[r.type];
                return (
                  <div key={r.id} className="surface line flex items-center gap-3 rounded-2xl border p-3 shadow-soft">
                    <span
                      className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${r.status === "OPEN" ? "bg-warn/15 text-warn" : "bg-(--sunken) text-(--muted)"}`}
                    >
                      <Icon className="h-6 w-6" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-lg font-bold">{r.tableLabel}</p>
                      <p className="muted text-sm capitalize">{r.type.replace("_", " ").toLowerCase()}</p>
                    </div>
                    {r.status === "OPEN" ? (
                      <Button variant="outline" onClick={() => handle(r.id, false)}>
                        On my way
                      </Button>
                    ) : (
                      <Button variant="success" onClick={() => handle(r.id, true)}>
                        Done
                      </Button>
                    )}
                  </div>
                );
              })}
            </Section>
          )}

          {b.pendingOrders.length > 0 && (
            <Section title="Confirm new orders" count={b.pendingOrders.length}>
              {b.pendingOrders.map((o) => (
                <div key={o.id} className="surface rounded-2xl border border-warn/60 p-3.5 shadow-soft">
                  <p className="text-lg font-bold">
                    {o.tableLabel} · #{o.orderNumber}
                  </p>
                  <p className="muted text-sm">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="success"
                      className="flex-1"
                      onClick={() => {
                        patch((x) => ({
                          ...x,
                          pendingOrders: x.pendingOrders.filter((p) => p.sessionId !== o.sessionId),
                        }));
                        queue(
                          send({
                            type: "session.confirm",
                            sessionId: o.sessionId,
                          }),
                        );
                      }}
                    >
                      Guests are seated ✓
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        act(
                          api("POST", `/v1/s/orders/${o.id}/reject`, {
                            reason: "No guests at table",
                          }),
                        )
                      }
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </Section>
          )}

          <Section title="My tables" count={b.tables.length}>
            <div className="grid grid-cols-2 gap-2.5 min-[420px]:grid-cols-3 sm:grid-cols-4">
              {b.tables.map((t) => (
                <div key={t.id} className={`surface flex flex-col rounded-2xl border p-3 shadow-soft ${TABLE_STYLE[t.status]}`}>
                  <span className="flex items-baseline justify-between gap-1">
                    <span className="text-xl font-extrabold">{t.label}</span>
                    <span className="muted truncate text-[11px] font-medium capitalize">{t.status.replace("_", " ").toLowerCase()}</span>
                  </span>
                  {t.session ? (
                    <span className="mt-1 flex items-center gap-1 text-xs">
                      <Users className="muted h-3.5 w-3.5" aria-hidden /> {t.session.guestCount} · code{" "}
                      <strong className="tracking-wider">{t.session.joinCode}</strong>
                    </span>
                  ) : (
                    <span className="mt-1 text-xs">&nbsp;</span>
                  )}
                  {t.status === "CLEANING" ? (
                    <button
                      className="mt-2.5 flex h-10 items-center justify-center rounded-xl bg-fresh text-sm font-semibold text-white hover:brightness-110"
                      onClick={() =>
                        act(
                          api("POST", `/v1/s/tables/${t.id}/status`, {
                            status: "FREE",
                          }),
                        )
                      }
                    >
                      Ready ✓
                    </button>
                  ) : (
                    <button
                      className="line mt-2.5 flex h-10 items-center justify-center gap-1 rounded-xl border bg-(--surface) text-sm font-semibold transition hover:border-brand/50 hover:text-brand"
                      onClick={() => setOrderFor(t)}
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Order
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {orderFor && <TakeOrder table={orderFor} onClose={() => setOrderFor(null)} onPlaced={refetch} />}
      {swapFor && <SwapItem item={swapFor} onClose={() => setSwapFor(null)} onDone={refetch} />}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="muted mb-3 flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
        {title}
        {count !== undefined && <span className="rounded-full bg-(--sunken) px-2 py-0.5 text-(--ink) tabular-nums">{count}</span>}
      </h2>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

/** Search box with an icon, for the dish pickers. */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-3">
      <Search className="muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" aria-hidden />
      <input type="search" placeholder="Search" aria-label="Search menu" value={value} onChange={(e) => onChange(e.target.value)} className="w-full pl-9" />
    </div>
  );
}

const PICK = "line h-10 shrink-0 rounded-xl border px-3 text-sm font-semibold transition hover:border-brand/50 hover:bg-brand/5 hover:text-brand";

interface Line {
  key: string;
  itemId: string;
  name: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
  unitPrice: number;
}

/** Required groups get their first available options, so a dish is one tap. Null if it can't be priced that way. */
function quickPick(menu: PublicMenu, groups: Map<string, PricingAddonGroup>, itemId: string, variantId: string | null) {
  const item = menu.items.find((i) => i.id === itemId);
  if (!item) return null;
  const addonIds = item.addonGroupIds.flatMap((gid) => {
    const g = groups.get(gid);
    return g && g.minSelect > 0
      ? g.addons
          .filter((a) => a.isAvailable)
          .slice(0, g.minSelect)
          .map((a) => a.id)
      : [];
  });
  const r = priceLine(item, groups, { variantId, addonIds, quantity: 1 });
  return r.ok ? { item, addonIds, line: r.line } : null;
}

/** Swap an out-of-stock item for something the guest chose; same quantity, same ticket. */
function SwapItem({ item, onClose, onDone }: { item: OrderItemView; onClose: () => void; onDone: () => void }) {
  const menu = useQuery({
    queryKey: ["staff-menu"],
    queryFn: () => api<PublicMenu>("GET", "/v1/s/menu"),
    staleTime: 60_000,
  });
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => new Map<string, PricingAddonGroup>((menu.data?.addonGroups ?? []).map((g) => [g.id, g])), [menu.data]);

  async function pick(itemId: string, variantId: string | null) {
    if (!menu.data) return;
    const p = quickPick(menu.data, groups, itemId, variantId);
    if (!p) return setError("That dish needs options. Ask the guest to choose it on their phone.");
    try {
      await api("POST", `/v1/s/order-items/${item.id}/replace`, {
        clientId: newClientId(),
        itemId,
        variantId,
        addonIds: p.addonIds,
      });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const items = (menu.data?.items ?? []).filter((i) => i.isAvailable && i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet open onClose={onClose} title={`${item.quantity} × ${item.name} → ?`}>
      <SearchBox value={q} onChange={setQ} />
      <ul className="max-h-[50dvh] divide-y divide-(--line) overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <span className="min-w-0 flex-1 font-medium">{i.name}</span>
            {i.variants.length ? (
              i.variants.map((v) => (
                <button key={v.id} className={PICK} onClick={() => void pick(i.id, v.id)}>
                  {v.name}
                </button>
              ))
            ) : (
              <button className={PICK} onClick={() => void pick(i.id, null)}>
                {rupees(i.price)}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 rounded-lg bg-late/10 px-3 py-2 text-sm font-medium text-late">{error}</p>}
    </Sheet>
  );
}

/** Waiter places an order for a table. Same pipeline as QR; required single choices auto-pick the first free option. */
function TakeOrder({ table, onClose, onPlaced }: { table: BoardTable; onClose: () => void; onPlaced: () => void }) {
  const menu = useQuery({
    queryKey: ["staff-menu"],
    queryFn: () => remembered("staff-menu", () => api<PublicMenu>("GET", "/v1/s/menu")),
    staleTime: 60_000,
  });
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(newClientId);
  const groups = useMemo(() => new Map<string, PricingAddonGroup>((menu.data?.addonGroups ?? []).map((g) => [g.id, g])), [menu.data]);

  function add(itemId: string, variantId: string | null) {
    if (!menu.data) return;
    const p = quickPick(menu.data, groups, itemId, variantId);
    if (!p) return setError("That dish needs options");
    const { item, addonIds, line } = p;
    const key = `${itemId}|${variantId}`;
    setLines((cur) => {
      const ex = cur.find((l) => l.key === key);
      if (ex) return cur.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      const name = `${item.name}${line.variantName ? ` (${line.variantName})` : ""}`;
      return [
        ...cur,
        {
          key,
          itemId,
          name,
          variantId,
          addonIds,
          quantity: 1,
          unitPrice: line.unitPrice,
        },
      ];
    });
  }

  /** Queued like every other action: works on the hub or offline; item ids are made here so every copy agrees on them. */
  async function place() {
    setError(null);
    try {
      await send(
        {
          type: "order.create",
          tableId: table.id,
          lines: lines.map(({ itemId, variantId, addonIds, quantity }) => ({
            id: newOrderedId(),
            itemId,
            variantId,
            addonIds,
            quantity,
          })),
        },
        clientId,
      );
      onPlaced();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const items = (menu.data?.items ?? []).filter((i) => i.isAvailable && i.name.toLowerCase().includes(q.toLowerCase()));
  const total = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);

  return (
    <Sheet open onClose={onClose} title={`Order for ${table.label}`}>
      <SearchBox value={q} onChange={setQ} />
      <ul className="max-h-[40dvh] divide-y divide-(--line) overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 py-2.5">
            <span className="min-w-0 flex-1 font-medium">{i.name}</span>
            {i.variants.length ? (
              i.variants.map((v) => (
                <button key={v.id} className={PICK} onClick={() => add(i.id, v.id)}>
                  {v.name}
                </button>
              ))
            ) : (
              <button className={PICK} onClick={() => add(i.id, null)}>
                + {rupees(i.price)}
              </button>
            )}
          </li>
        ))}
      </ul>
      {lines.length > 0 && (
        <ul className="mt-3 space-y-1.5 rounded-xl bg-(--sunken) p-3">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center justify-between gap-2 text-sm">
              <span>
                <strong>{l.quantity} ×</strong> {l.name}
              </span>
              <button
                className="muted grid h-8 w-8 place-items-center rounded-lg hover:bg-late/10 hover:text-late"
                aria-label={`Remove ${l.name}`}
                onClick={() => setLines((c) => c.filter((x) => x.key !== l.key))}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 rounded-lg bg-late/10 px-3 py-2 text-sm font-medium text-late">{error}</p>}
      <Button className="mt-4 w-full" disabled={lines.length === 0} onClick={() => void place()}>
        <Check className="h-4 w-4" aria-hidden />
        Send to kitchen · {rupees(total)}
      </Button>
    </Sheet>
  );
}
