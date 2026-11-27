"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ItemStatus, KdsTicket, OrderItemView } from "@rms/contracts";
import { ageLevel, aggregatePending, type AgeLevel } from "@rms/domain";
import { api, remembered } from "@/lib/api";
import { afterSending, send } from "@/lib/outbox";
import { useRinger } from "@/lib/ringer";
import { RingBanner } from "@/components/RingBanner";
import { useGuard } from "@/lib/auth";
import { AlertsBar, AlertsMenu } from "@/components/AlertsBar";
import { useAlerts } from "@/lib/push";
import { chime, useStaffSocket } from "@/lib/realtime";
import { useSound } from "@/lib/sound";
import { Check, CheckCheck, Flame, PackageX, StickyNote, Timer } from "lucide-react";
import { ParcelTag, Button, OfflineBanner, RejectionToast, TopBar } from "@/components/ui";
import { confirm } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";

const AGE_CARD: Record<AgeLevel, string> = { fresh: "ring-(--line)", warning: "ring-warn/45", late: "ring-late/60" };
const AGE_PILL: Record<AgeLevel, string> = { fresh: "bg-fresh/12 text-fresh", warning: "bg-warn/15 text-warn", late: "bg-late/15 text-late" };
const AGE_BAR: Record<AgeLevel, string> = { fresh: "bg-fresh", warning: "bg-warn", late: "bg-late" };

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] items-start gap-4 px-4 pb-10 sm:gap-5 sm:px-6";

const ago = (mins: number) => (mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${mins % 60}m`);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const NEXT: Partial<Record<ItemStatus, ItemStatus>> = { QUEUED: "COOKING", COOKING: "READY" };

/** Kitchen display: phone or tablet, dark, big targets. Tap item = start → ready. "All ready" = whole ticket. */
export default function KdsPage() {
  const me = useGuard(["COOK", "MANAGER", "OWNER"]);
  const qc = useQueryClient();
  const sound = useSound();
  const [now, setNow] = useState(() => Date.now());
  const [showStock, setShowStock] = useState(false);
  const alerts = useAlerts(Boolean(me));
  const station = me?.typ === "staff" && me.stationId ? me.stationId : "all";

  useEffect(() => {
    document.documentElement.classList.add("dark");
    // The kitchen is always dark, but the status-bar colour follows the OS: swap it too, or a light-mode tablet
    // shows a white bar over a dark screen. The plain TopBar sits on --bg.
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const before = metas.map((m) => m.content);
    metas.forEach((m) => (m.content = "#0f151c"));
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      clearInterval(t);
      document.documentElement.classList.remove("dark");
      metas.forEach((m, i) => (m.content = before[i] ?? m.content));
    };
  }, []);

  const tickets = useQuery({
    queryKey: ["kds", station],
    queryFn: () => remembered(`kds:${station}`, () => api<KdsTicket[]>("GET", `/v1/s/kds?station=${station}`)),
    enabled: Boolean(me),
    refetchInterval: 30_000, // safety net if a socket event is missed
  });

  // after this screen's own taps have reached the server, so a live update can't flash them back
  const refetch = useCallback(() => afterSending(() => void qc.invalidateQueries({ queryKey: ["kds"] })), [qc]);
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
    const ok = await confirm({
      title: `${item.name} ran out?`,
      description: "The guest is asked to choose something else, and the dish is hidden from every menu until you mark it back in stock.",
      confirmLabel: "Mark as ran out",
      destructive: true,
    });
    if (!ok) return;
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
  // Rings until a cook starts each new ticket (taps any dish on it)
  const untouched = (tickets.data ?? []).filter((t) => t.items.length > 0 && t.items.every((i) => i.status === "QUEUED"));
  const ringKey = untouched.map((t) => t.id).sort().join();
  const ringer = useRinger(ringKey !== "", ringKey);

  if (!me) return null;
  const list = (tickets.data ?? []).filter((t) => t.items.some((i) => i.status !== "READY"));

  return (
    <div className="min-h-dvh">
      <TopBar plain title="Kitchen" subtitle={station === "all" ? "All stations" : undefined} online={online}>
        <AlertsMenu alerts={alerts} />
      </TopBar>
      <OfflineBanner online={online} />
      <AlertsBar enabled shared={alerts} waiting={untouched.length > 0} />
      <RingBanner
        ringing={ringer.ringing}
        label={`${untouched.length} new ticket${untouched.length > 1 ? "s" : ""}: ${untouched.map((t) => t.tableLabel).join(", ")}. Tap a dish to start.`}
        onSnooze={() => ringer.snooze()}
      />
      <RejectionToast />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-4 pt-3 pb-5 sm:px-6">
        <div role="group" aria-label="Show" className="surface grid w-full grid-cols-2 rounded-full p-1 sm:w-72">
          {[false, true].map((stock) => (
            <button
              key={String(stock)}
              aria-pressed={showStock === stock}
              onClick={() => setShowStock(stock)}
              className={`flex h-11 items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition ${showStock === stock ? "bg-(--sunken) text-(--ink)" : "muted hover:text-(--ink)"}`}
            >
              {stock ? "Stock" : "Tickets"}
              {!stock && list.length > 0 && <span className="rounded-full bg-brand px-2 text-sm leading-6 text-brand-ink tabular-nums">{list.length}</span>}
            </button>
          ))}
        </div>
        {!showStock && pending.length > 0 && (
          <div className="scroll-x flex min-w-0 flex-1 basis-60 items-center gap-5" aria-label="Pending totals">
            {pending.map((p) => (
              <span key={`${p.name}${p.variantName}`} className="shrink-0 text-base whitespace-nowrap">
                <strong className="mr-1.5 font-display text-lg text-brand tabular-nums">{p.quantity}×</strong>
                {p.name}
                {p.variantName && <span className="muted"> ({p.variantName})</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {showStock ? (
        <StockPanel />
      ) : tickets.isLoading ? (
        <div className={GRID} role="status" aria-label="Loading">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-64 rounded-3xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex min-h-[55dvh] animate-rise flex-col items-center justify-center px-6 text-center">
          <span className="grid h-24 w-24 place-items-center rounded-full bg-fresh/10 text-fresh">
            <CheckCheck className="h-10 w-10" aria-hidden />
          </span>
          <p className="mt-6 font-display text-2xl font-bold tracking-tight">No open tickets</p>
          <p className="muted mt-2 max-w-xs text-base text-pretty">{!sound.on ? "All caught up. Sound is off: new orders won't ring." : sound.ready ? "All caught up. New orders appear here by themselves." : "All caught up. Tap anywhere once so new orders can ring."}</p>
        </div>
      ) : (
        <div className={GRID}>
          {list.map((t) => (
            <TicketCard key={t.id} ticket={t} now={now} onAdvance={advance} onRanOut={ranOut} onBump={bump} />
          ))}
        </div>
      )}
    </div>
  );
}

type Item = KdsTicket["items"][number];

/** One order. Colour says how late it is; each dish is one big tap: start, then ready. */
function TicketCard({
  ticket: t,
  now,
  onAdvance,
  onRanOut,
  onBump,
}: {
  ticket: KdsTicket;
  now: number;
  onAdvance: (i: Item) => Promise<void>;
  onRanOut: (i: Item) => Promise<void>;
  onBump: (t: KdsTicket) => Promise<void>;
}) {
  const prep = Math.max(1, ...t.items.map((i) => i.prepTimeMin));
  const elapsed = Math.max(0, now - new Date(t.placedAt).getTime());
  const level = ageLevel(new Date(t.placedAt), prep, new Date(now));
  const untouched = t.items.every((i) => i.status === "QUEUED");
  const done = t.items.filter((i) => i.status === "READY").length;
  return (
    <article className={`surface flex animate-pop flex-col overflow-hidden rounded-3xl shadow-lift ring-1 ring-inset ${AGE_CARD[level]}`}>
      <div className="mx-5 mt-5 h-1 overflow-hidden rounded-full bg-(--sunken)" aria-hidden>
        <div
          className={`h-full w-full origin-left rounded-full transition-transform duration-700 ${AGE_BAR[level]}`}
          style={{ transform: `scaleX(${Math.min(1, elapsed / (prep * 60_000))})` }}
        />
      </div>
      <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <h2 className="text-3xl leading-none font-extrabold break-words">
            {t.tableLabel}
          </h2>
          <p className="muted mt-2 text-sm tabular-nums">
            {untouched && <span className="mr-2 rounded-full bg-brand px-2.5 py-0.5 text-xs font-bold text-brand-ink">New</span>}
            #{t.orderNumber} · {clock(t.placedAt)}
            {done > 0 && ` · ${done} of ${t.items.length} ready`}
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-base font-bold tabular-nums ${AGE_PILL[level]}`}>
          <Timer className={`h-4 w-4 ${level === "late" ? "animate-pulse" : ""}`} aria-hidden />
          {ago(Math.floor(elapsed / 60_000))}
        </span>
      </header>
      {t.note && (
        <p className="mx-5 mb-2 flex items-start gap-2.5 rounded-2xl bg-warn/12 px-4 py-3 text-base font-semibold text-warn">
          <StickyNote className="mt-1 h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 break-words">{t.note}</span>
        </p>
      )}
      <ul className="px-2.5">
        {t.items.map((i) => (
          <ItemRow key={i.id} item={i} onAdvance={onAdvance} onRanOut={onRanOut} />
        ))}
      </ul>
      <div className="p-4 pt-3">
        <Button variant="success" className="h-14 w-full text-lg" onClick={() => void onBump(t)}>
          <CheckCheck aria-hidden />
          All ready
        </Button>
      </div>
    </article>
  );
}

const TILE: Partial<Record<ItemStatus, string>> = { QUEUED: "bg-(--sunken)", COOKING: "bg-brand text-brand-ink", READY: "bg-fresh/15 text-fresh" };

function ItemRow({ item: i, onAdvance, onRanOut }: { item: Item; onAdvance: (i: Item) => Promise<void>; onRanOut: (i: Item) => Promise<void> }) {
  const ready = i.status === "READY";
  const cooking = i.status === "COOKING";
  return (
    <li className={`flex items-center rounded-2xl transition-colors ${cooking ? "bg-brand/8" : ""}`}>
      <button
        onClick={() => void onAdvance(i)}
        disabled={ready}
        className="flex min-h-16 min-w-0 flex-1 items-start gap-3.5 rounded-2xl p-2.5 text-left transition enabled:hover:bg-(--sunken)/60 enabled:active:scale-[0.98]"
        aria-label={`${i.name}: ${i.status === "QUEUED" ? "tap to start" : cooking ? "tap when ready" : "ready"}`}
      >
        <span className={`grid h-11 min-w-11 shrink-0 place-items-center rounded-xl px-1.5 font-display text-lg font-bold tabular-nums transition-colors ${TILE[i.status] ?? ""}`}>
          {ready ? <Check className="h-5 w-5" aria-hidden /> : `${i.quantity}×`}
        </span>
        <span className={`min-w-0 flex-1 break-words ${ready ? "opacity-50" : ""}`}>
          <span className={`block text-lg leading-snug font-semibold ${ready ? "line-through" : ""}`}>
            {ready && i.quantity > 1 && `${i.quantity}× `}
            {i.name}
            {i.variantName && <span className="muted font-normal"> ({i.variantName})</span>}
            {i.isParcel && " "}
            {i.isParcel && <ParcelTag />}
          </span>
          {i.addons.length > 0 && <span className="muted block text-base">+ {i.addons.map((a) => a.name).join(", ")}</span>}
          {i.note && <span className="block text-base font-semibold text-warn">“{i.note}”</span>}
          <span className={`mt-0.5 flex items-center gap-1.5 text-sm font-medium ${cooking ? "text-brand" : "muted"}`}>
            {cooking && <Flame className="h-3.5 w-3.5" aria-hidden />}
            {ready ? "Ready" : cooking ? "Cooking, tap when ready" : "Tap to start"}
          </span>
        </span>
      </button>
      {!ready && (
        <button
          onClick={() => void onRanOut(i)}
          className="muted mr-1 grid h-12 w-12 shrink-0 place-items-center rounded-full transition hover:bg-late/10 hover:text-late"
          aria-label={`${i.name}: ran out`}
          title="Ran out: the guest picks something else, and it's hidden from the menu"
        >
          <PackageX className="h-5 w-5" aria-hidden />
        </button>
      )}
    </li>
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
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3 px-4 pb-10 sm:px-6">
      {(items.data ?? []).map((i) => (
        <li key={i.id}>
          <button
            onClick={() => void toggle(i.id, !i.isAvailable)}
            aria-pressed={!i.isAvailable}
            className="surface flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left transition hover:bg-(--sunken)"
          >
            <span className="min-w-0 flex-1">
              <span className={`block text-lg leading-snug font-semibold break-words ${i.isAvailable ? "" : "muted line-through"}`}>{i.name}</span>
              <span className={`mt-0.5 block text-sm font-medium ${i.isAvailable ? "muted" : "text-late"}`}>{i.isAvailable ? "In stock" : "Out of stock"}</span>
            </span>
            <span className={`h-7 w-12 shrink-0 rounded-full p-0.5 transition-colors ${i.isAvailable ? "bg-fresh" : "bg-(--line)"}`} aria-hidden>
              <span className={`block h-6 w-6 rounded-full bg-white transition-transform ${i.isAvailable ? "translate-x-5" : ""}`} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
