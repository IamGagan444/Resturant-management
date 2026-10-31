"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ItemStatus, KdsTicket, OrderItemView } from "@rms/contracts";
import { ageLevel, aggregatePending, type AgeLevel } from "@rms/domain";
import { api, remembered } from "@/lib/api";
import { send } from "@/lib/outbox";
import { useGuard } from "@/lib/auth";
import { chime, unlockSound, useStaffSocket } from "@/lib/realtime";
import { Bell, CheckCheck, CheckCircle2, Circle, ClipboardList, Flame, PackageX, StickyNote } from "lucide-react";
import { Button, OfflineBanner, RejectionToast, TopBar } from "@/components/ui";

const AGE_STYLE: Record<AgeLevel, string> = {
  fresh: "border-fresh/70",
  warning: "border-warn",
  late: "border-late animate-[pulse_2s_ease-in-out_infinite]",
};
const AGE_HEADER: Record<AgeLevel, string> = { fresh: "bg-fresh", warning: "bg-warn text-black", late: "bg-late" };

const NEXT: Partial<Record<ItemStatus, ItemStatus>> = { QUEUED: "COOKING", COOKING: "READY" };

/** Kitchen display: tablet landscape, dark, big targets. Tap item = start → ready. Bump = whole ticket ready. */
export default function KdsPage() {
  const me = useGuard(["COOK", "MANAGER", "OWNER"]);
  const qc = useQueryClient();
  const [soundOn, setSoundOn] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showStock, setShowStock] = useState(false);
  const station = me?.typ === "staff" && me.stationId ? me.stationId : "all";

  useEffect(() => {
    document.documentElement.classList.add("dark");
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(t);
      document.documentElement.classList.remove("dark");
    };
  }, []);

  const tickets = useQuery({
    queryKey: ["kds", station],
    queryFn: () => remembered(`kds:${station}`, () => api<KdsTicket[]>("GET", `/v1/s/kds?station=${station}`)),
    enabled: Boolean(me),
    refetchInterval: 30_000, // safety net if a socket event is missed
  });

  const refetch = useCallback(() => void qc.invalidateQueries({ queryKey: ["kds"] }), [qc]);
  const { online } = useStaffSocket(Boolean(me), refetch, (s) => {
    s.on("order:placed", (e) => {
      if (station === "all" || e.stationIds.length === 0 || e.stationIds.includes(station)) chime("order");
      refetch();
    });
    s.on("item:status_changed", refetch);
    s.on("order:cancelled", refetch);
  });

  /** Optimistic local change; the queue makes sure the server gets it, now or after an outage. */
  function patch(ids: string[], to: ItemStatus | null) {
    qc.setQueryData<KdsTicket[]>(["kds", station], (cur) =>
      cur
        ?.map((t) => ({ ...t, items: to ? t.items.map((i) => (ids.includes(i.id) ? { ...i, status: to } : i)) : t.items.filter((i) => !ids.includes(i.id)) }))
        .filter((t) => t.items.length > 0),
    );
  }

  async function advance(item: OrderItemView) {
    const to = NEXT[item.status];
    if (!to) return;
    patch([item.id], to);
    await send({ type: "item.transition", orderItemId: item.id, to }).catch(refetch);
  }

  /** One tap: this order's guest is asked to pick something else, and the dish is hidden from every menu. */
  async function ranOut(item: KdsTicket["items"][number]) {
    if (!confirm(`${item.name} ran out? The guest will be asked to choose something else.`)) return;
    patch([item.id], null);
    await send({ type: "item.transition", orderItemId: item.id, to: "OUT_OF_STOCK" }).catch(refetch);
    await send({ type: "menu.availability", menuItemId: item.itemId, isAvailable: false }).catch(refetch);
  }

  /** Bump = every item on this ticket that this screen shows → ready (other stations' items are theirs). */
  async function bump(ticket: KdsTicket) {
    const todo = ticket.items.filter((i) => i.status === "QUEUED" || i.status === "COOKING");
    patch(todo.map((i) => i.id), "READY");
    for (const i of todo) await send({ type: "item.transition", orderItemId: i.id, to: "READY" }).catch(refetch);
  }

  const pending = useMemo(() => aggregatePending((tickets.data ?? []).flatMap((t) => t.items.map((i) => ({ ...i, name: i.name })))), [tickets.data]);
  if (!me) return null;
  const list = (tickets.data ?? []).filter((t) => t.items.some((i) => i.status !== "READY"));

  return (
    <div className="min-h-dvh">
      <TopBar title={station === "all" ? "Kitchen · all stations" : "Kitchen"} online={online}>
        {!soundOn && (
          <Button
            variant="outline"
            className="text-sm"
            onClick={() => {
              unlockSound();
              setSoundOn(true);
              chime();
            }}
          >
            <Bell className="h-4 w-4" aria-hidden />
            Enable sound
          </Button>
        )}
        <Button variant="outline" className="text-sm" onClick={() => setShowStock((v) => !v)}>
          {showStock ? <ClipboardList className="h-4 w-4" aria-hidden /> : <PackageX className="h-4 w-4" aria-hidden />}
          {showStock ? "Tickets" : "Stock"}
        </Button>
      </TopBar>
      <OfflineBanner online={online} />
      <RejectionToast />

      {pending.length > 0 && (
        <div className="line scroll-x flex gap-2 border-b bg-(--sunken) px-4 py-2.5" aria-label="Pending totals">
          {pending.map((p) => (
            <span key={`${p.name}${p.variantName}`} className="surface line shrink-0 rounded-full border px-3.5 py-1 text-lg font-semibold whitespace-nowrap">
              {p.quantity} × {p.name}
              {p.variantName ? ` (${p.variantName})` : ""}
            </span>
          ))}
        </div>
      )}

      {showStock ? (
        <StockPanel />
      ) : list.length === 0 ? (
        <div className="muted flex flex-col items-center gap-3 py-24 text-center">
          <CheckCheck className="h-14 w-14 text-fresh" aria-hidden />
          <p className="text-2xl font-semibold">No open tickets</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,290px),1fr))] gap-4 p-3 sm:p-4">
          {list.map((t) => {
            const level = ageLevel(new Date(t.placedAt), Math.max(...t.items.map((i) => i.prepTimeMin)), new Date(now));
            const mins = Math.floor((now - new Date(t.placedAt).getTime()) / 60_000);
            return (
              <article key={t.id} className={`surface flex flex-col overflow-hidden rounded-2xl border-2 shadow-lift ${AGE_STYLE[level]}`}>
                <header className={`flex items-baseline justify-between px-4 py-2.5 text-white ${AGE_HEADER[level]}`}>
                  <span className="text-2xl font-extrabold">{t.tableLabel}</span>
                  <span className="text-lg font-semibold opacity-90">#{t.orderNumber}</span>
                  <span className="rounded-full bg-black/15 px-2.5 text-lg font-bold tabular-nums">{mins}m</span>
                </header>
                {t.note && (
                  <p className="flex items-center gap-2 bg-warn/20 px-4 py-1.5 font-semibold">
                    <StickyNote className="h-4 w-4 shrink-0" aria-hidden />
                    {t.note}
                  </p>
                )}
                <ul className="flex-1 divide-y divide-(--line)">
                  {t.items.map((i) => (
                    <li key={i.id} className="flex items-stretch">
                      <button
                        onClick={() => void advance(i)}
                        disabled={i.status === "READY"}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left text-xl transition hover:bg-(--sunken) ${i.status === "READY" ? "opacity-40" : ""} ${i.status === "COOKING" ? "bg-brand/8" : ""}`}
                        aria-label={`${i.name}: ${i.status === "QUEUED" ? "tap to start" : i.status === "COOKING" ? "tap when ready" : "ready"}`}
                      >
                        <span className="mt-0.5 shrink-0" aria-hidden>
                          {i.status === "QUEUED" ? (
                            <Circle className="muted h-6 w-6" />
                          ) : i.status === "COOKING" ? (
                            <Flame className="h-6 w-6 text-brand" />
                          ) : (
                            <CheckCircle2 className="h-6 w-6 text-fresh" />
                          )}
                        </span>
                        <span className="flex-1">
                          <strong>{i.quantity} ×</strong> {i.name}
                          {i.variantName && <span className="muted"> ({i.variantName})</span>}
                          {i.addons.length > 0 && <span className="muted block text-base">+ {i.addons.map((a) => a.name).join(", ")}</span>}
                          {i.note && <span className="block text-base font-semibold text-warn">“{i.note}”</span>}
                        </span>
                      </button>
                      {i.status !== "READY" && (
                        <button
                          onClick={() => void ranOut(i)}
                          className="line muted shrink-0 border-l px-3 text-sm font-semibold transition hover:bg-late/10 hover:text-late"
                          aria-label={`${i.name}: ran out`}
                          title="Ran out: the guest picks something else, and it's hidden from the menu"
                        >
                          Ran out
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                <Button variant="success" className="m-3 h-14 rounded-xl text-xl" onClick={() => void bump(t)}>
                  Bump ✓
                </Button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One tap per item to mark out of stock; it vanishes from customer menus instantly. */
function StockPanel() {
  const qc = useQueryClient();
  const items = useQuery({
    queryKey: ["stock"],
    queryFn: () => remembered("stock", () => api<{ id: string; name: string; isAvailable: boolean }[]>("GET", "/v1/s/menu-items")),
  });
  async function toggle(id: string, isAvailable: boolean) {
    qc.setQueryData<{ id: string; name: string; isAvailable: boolean }[]>(["stock"], (cur) => cur?.map((i) => (i.id === id ? { ...i, isAvailable } : i)));
    await send({ type: "menu.availability", menuItemId: id, isAvailable }).catch(() => qc.invalidateQueries({ queryKey: ["stock"] }));
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-3 p-3 sm:p-4">
      {(items.data ?? []).map((i) => (
        <li key={i.id}>
          <button
            onClick={() => void toggle(i.id, !i.isAvailable)}
            aria-pressed={!i.isAvailable}
            className={`tap w-full rounded-2xl border px-4 py-3 text-left text-lg font-semibold transition ${i.isAvailable ? "line surface hover:border-late/50" : "border-late bg-late/15"}`}
          >
            <span className={i.isAvailable ? "" : "line-through"}>{i.name}</span>
            <span className={`mt-0.5 flex items-center gap-1.5 text-sm font-medium ${i.isAvailable ? "text-fresh" : "text-late"}`}>
              <span className={`h-2 w-2 rounded-full ${i.isAvailable ? "bg-fresh" : "bg-late"}`} aria-hidden />
              {i.isAvailable ? "In stock" : "Out of stock"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
