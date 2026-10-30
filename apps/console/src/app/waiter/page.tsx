"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BoardTable, OrderItemView, PublicMenu, RequestType, WaiterBoard } from "@rms/contracts";
import { priceLine, type PricingAddonGroup } from "@rms/domain";
import { api, newClientId, newOrderedId, remembered, rupees } from "@/lib/api";
import { send } from "@/lib/outbox";
import { useGuard } from "@/lib/auth";
import { buzz, chime, unlockSound, useStaffSocket } from "@/lib/realtime";
import { Button, OfflineBanner, RejectionToast, TopBar } from "@/components/ui";
import { Sheet } from "@/components/Sheet";

type Board = WaiterBoard;

const REQ_ICON: Record<RequestType, string> = { CALL_WAITER: "🙋", WATER: "💧", CUTLERY: "🍴", BILL: "🧾", OTHER: "❓" };
const TABLE_STYLE: Record<string, string> = {
  FREE: "line",
  OCCUPIED: "border-brand",
  BILL_REQUESTED: "border-warn bg-warn/10",
  CLEANING: "border-stone-400 bg-stone-500/10",
  RESERVED: "border-blue-500",
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
  const refetch = useCallback(() => void qc.invalidateQueries({ queryKey: ["board"] }), [qc]);
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
    for (const ev of ["session:guest_joined", "order:placed", "request:done", "bill:paid", "table:status_changed", "item:out_of_stock"] as const) s.on(ev, refetch);
  });

  const act = (p: Promise<unknown>) => void p.finally(refetch);
  /** Optimistic board change; the queue delivers the command now or after an outage. */
  const patch = (fn: (b: Board) => Board) => qc.setQueryData<Board>(["board"], (b) => (b ? fn(b) : b));
  const queue = (p: Promise<void>) => void p.catch(refetch);
  const move = (id: string, to: "PICKED_UP" | "SERVED") => {
    patch((b) => ({ ...b, ready: to === "SERVED" ? b.ready.filter((i) => i.id !== id) : b.ready.map((i) => (i.id === id ? { ...i, status: to } : i)) }));
    queue(send({ type: "item.transition", orderItemId: id, to }));
  };
  const handle = (id: string, done: boolean) => {
    patch((b) => ({ ...b, requests: done ? b.requests.filter((r) => r.id !== id) : b.requests.map((r) => (r.id === id ? { ...r, status: "ACKNOWLEDGED" } : r)) }));
    queue(send(done ? { type: "request.done", requestId: id } : { type: "request.ack", requestId: id }));
  };

  if (!me) return null;
  const b = board.data;

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-12">
      <TopBar title="Floor" online={online}>
        {!alerts && (
          <Button variant="outline" onClick={() => (unlockSound(), setAlerts(true), chime())}>
            🔔 Alerts on
          </Button>
        )}
      </TopBar>
      <OfflineBanner online={online} />
      <RejectionToast />
      {escalation && (
        <button className="w-full bg-late px-4 py-3 text-left font-semibold text-white" onClick={() => setEscalation(null)}>
          ⏰ {escalation} — tap to dismiss
        </button>
      )}

      {b && (
        <div className="space-y-6 p-4">
          {b.ready.length > 0 && (
            <Section title={`Pick up (${b.ready.length})`}>
              {b.ready.map((i) => (
                <div key={i.id} className={`surface flex items-center gap-3 rounded-xl border-2 p-3 ${i.status === "OUT_OF_STOCK" ? "border-late" : "border-fresh"}`}>
                  <div className="flex-1">
                    <p className="text-lg font-bold">{b.tables.find((t) => t.session?.id === i.sessionId)?.label ?? "?"}</p>
                    <p>
                      {i.quantity} × {i.name}
                      {i.variantName ? ` (${i.variantName})` : ""}
                    </p>
                    {i.status === "OUT_OF_STOCK" && <p className="text-sm text-late">Out of stock — ask the guest what they'd like instead</p>}
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
            <Section title="Requests">
              {b.requests.map((r) => (
                <div key={r.id} className="surface line flex items-center gap-3 rounded-xl border p-3">
                  <span className="text-3xl" aria-hidden>
                    {REQ_ICON[r.type]}
                  </span>
                  <div className="flex-1">
                    <p className="text-lg font-bold">{r.tableLabel}</p>
                    <p className="muted text-sm">{r.type.replace("_", " ").toLowerCase()}</p>
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
              ))}
            </Section>
          )}

          {b.pendingOrders.length > 0 && (
            <Section title="Confirm new orders">
              {b.pendingOrders.map((o) => (
                <div key={o.id} className="surface rounded-xl border-2 border-warn p-3">
                  <p className="text-lg font-bold">
                    {o.tableLabel} · #{o.orderNumber}
                  </p>
                  <p className="muted text-sm">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="success"
                      className="flex-1"
                      onClick={() => {
                        patch((x) => ({ ...x, pendingOrders: x.pendingOrders.filter((p) => p.sessionId !== o.sessionId) }));
                        queue(send({ type: "session.confirm", sessionId: o.sessionId }));
                      }}
                    >
                      Guests are seated ✓
                    </Button>
                    <Button variant="outline" onClick={() => act(api("POST", `/v1/s/orders/${o.id}/reject`, { reason: "No guests at table" }))}>
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </Section>
          )}

          <Section title="My tables">
            <div className="grid grid-cols-3 gap-2">
              {b.tables.map((t) => (
                <div key={t.id} className={`surface flex flex-col rounded-xl border-2 p-2 ${TABLE_STYLE[t.status]}`}>
                  <span className="text-xl font-black">{t.label}</span>
                  <span className="muted text-xs">{t.status.replace("_", " ").toLowerCase()}</span>
                  {t.session && (
                    <span className="text-xs">
                      👥 {t.session.guestCount} · code <strong>{t.session.joinCode}</strong>
                    </span>
                  )}
                  {t.status === "CLEANING" ? (
                    <button className="mt-1 rounded-lg bg-fresh py-2 text-sm font-semibold text-white" onClick={() => act(api("POST", `/v1/s/tables/${t.id}/status`, { status: "FREE" }))}>
                      Ready ✓
                    </button>
                  ) : (
                    <button className="line mt-1 rounded-lg border py-2 text-sm font-semibold" onClick={() => setOrderFor(t)}>
                      + Order
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold tracking-wide uppercase muted">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

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
    return g && g.minSelect > 0 ? g.addons.filter((a) => a.isAvailable).slice(0, g.minSelect).map((a) => a.id) : [];
  });
  const r = priceLine(item, groups, { variantId, addonIds, quantity: 1 });
  return r.ok ? { item, addonIds, line: r.line } : null;
}

/** Swap an out-of-stock item for something the guest chose; same quantity, same ticket. */
function SwapItem({ item, onClose, onDone }: { item: OrderItemView; onClose: () => void; onDone: () => void }) {
  const menu = useQuery({ queryKey: ["staff-menu"], queryFn: () => api<PublicMenu>("GET", "/v1/s/menu"), staleTime: 60_000 });
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const groups = useMemo(() => new Map<string, PricingAddonGroup>((menu.data?.addonGroups ?? []).map((g) => [g.id, g])), [menu.data]);

  async function pick(itemId: string, variantId: string | null) {
    if (!menu.data) return;
    const p = quickPick(menu.data, groups, itemId, variantId);
    if (!p) return setError("That dish needs options. Ask the guest to choose it on their phone.");
    try {
      await api("POST", `/v1/s/order-items/${item.id}/replace`, { clientId: newClientId(), itemId, variantId, addonIds: p.addonIds });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }

  const items = (menu.data?.items ?? []).filter((i) => i.isAvailable && i.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet open onClose={onClose} title={`${item.quantity} × ${item.name} → ?`}>
      <input type="search" placeholder="Search" aria-label="Search menu" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 w-full" />
      <ul className="max-h-[50dvh] divide-y divide-(--line) overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">{i.name}</span>
            {i.variants.length ? (
              i.variants.map((v) => (
                <button key={v.id} className="line rounded-lg border px-3 py-2 text-sm" onClick={() => void pick(i.id, v.id)}>
                  {v.name}
                </button>
              ))
            ) : (
              <button className="line rounded-lg border px-3 py-2 text-sm" onClick={() => void pick(i.id, null)}>
                {rupees(i.price)}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-late">{error}</p>}
    </Sheet>
  );
}

/** Waiter places an order for a table. Same pipeline as QR; required single choices auto-pick the first free option. */
function TakeOrder({ table, onClose, onPlaced }: { table: BoardTable; onClose: () => void; onPlaced: () => void }) {
  const menu = useQuery({ queryKey: ["staff-menu"], queryFn: () => remembered("staff-menu", () => api<PublicMenu>("GET", "/v1/s/menu")), staleTime: 60_000 });
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
      return [...cur, { key, itemId, name, variantId, addonIds, quantity: 1, unitPrice: line.unitPrice }];
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
          lines: lines.map(({ itemId, variantId, addonIds, quantity }) => ({ id: newOrderedId(), itemId, variantId, addonIds, quantity })),
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
      <input type="search" placeholder="Search" aria-label="Search menu" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 w-full" />
      <ul className="max-h-[40dvh] divide-y divide-(--line) overflow-y-auto">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1">{i.name}</span>
            {i.variants.length ? (
              i.variants.map((v) => (
                <button key={v.id} className="line rounded-lg border px-3 py-2 text-sm" onClick={() => add(i.id, v.id)}>
                  {v.name}
                </button>
              ))
            ) : (
              <button className="line rounded-lg border px-3 py-2 text-sm" onClick={() => add(i.id, null)}>
                + {rupees(i.price)}
              </button>
            )}
          </li>
        ))}
      </ul>
      {lines.length > 0 && (
        <ul className="line mt-3 space-y-1 border-t pt-3">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center justify-between">
              <span>
                {l.quantity} × {l.name}
              </span>
              <button className="muted px-2" aria-label={`Remove ${l.name}`} onClick={() => setLines((c) => c.filter((x) => x.key !== l.key))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-late">{error}</p>}
      <Button className="mt-4 w-full" disabled={lines.length === 0} onClick={() => void place()}>
        Send to kitchen · {rupees(total)}
      </Button>
    </Sheet>
  );
}
