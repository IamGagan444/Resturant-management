"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillView, OrderItemView, OrderView, PublicMenu, RequestType, SessionView, TableLookup } from "@rms/contracts";
import { ApiError, api, deviceId, newClientId } from "@/lib/api";
import { LangProvider, useI18n } from "@/lib/i18n";
import { useSessionSocket } from "@/lib/realtime";
import { PaymentCancelled, isBusyPaying, payByUpi } from "@/lib/upi";
import { Join, type Joined } from "./Join";
import { Menu, SwapSheet, tName, type AddLine } from "./Menu";
import { Orders } from "./Orders";
import { Bill } from "./Bill";
import { CheckCircle2, MessageCircle, RotateCcw, ShoppingBag, WifiOff } from "lucide-react";
import { Button, FoodMark, LangPicker, Pill, Sheet, Toast, rupees } from "./ui";

export function TableApp(props: { initialMenu: PublicMenu; qrToken: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }));
  return (
    <LangProvider fallback={props.initialMenu.hotel.defaultLanguage}>
      <QueryClientProvider client={client}>
        <Inner {...props} />
      </QueryClientProvider>
    </LangProvider>
  );
}

type Phase =
  | { kind: "boot" }
  | { kind: "join"; lookup: TableLookup }
  | { kind: "in"; guestToken: string }
  | { kind: "paid"; receiptUrl: string | null }
  | { kind: "ended"; message: string };
type Tab = "menu" | "orders" | "bill";

function Inner({ initialMenu, qrToken }: { initialMenu: PublicMenu; qrToken: string }) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });
  const [tab, setTab] = useState<Tab>("menu");
  const [cartOpen, setCartOpen] = useState(false);
  const [swapping, setSwapping] = useState<OrderItemView | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const inSession = phase.kind === "in";

  // ── Boot: same phone rejoins silently; new phone sees the join screen ──
  useEffect(() => {
    (async () => {
      try {
        const lookup = await api<TableLookup>("GET", `/v1/p/t/${qrToken}?deviceId=${deviceId()}`);
        const name = localStorage.getItem("rms.name");
        if (lookup.isMember && name) {
          const j = await api<Joined>("POST", "/v1/p/sessions/join", { qrToken, deviceId: deviceId(), name });
          enter(j);
        } else setPhase({ kind: "join", lookup });
      } catch (e) {
        setPhase({ kind: "ended", message: e instanceof Error ? e.message : "Could not open this table" });
      }
    })();
    // Runs once per QR; `enter` only touches stable setters.
  }, [qrToken]);

  function enter(j: Joined) {
    qc.setQueryData(["session"], j.session);
    setPhase({ kind: "in", guestToken: j.guestToken });
  }

  const onSessionError = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) setPhase((p) => (p.kind === "paid" ? p : { kind: "ended", message: e.message }));
  }, []);

  const menuQ = useQuery({
    queryKey: ["menu"],
    queryFn: () => api<PublicMenu>("GET", `/v1/p/h/${initialMenu.hotel.slug}/menu`),
    initialData: initialMenu,
    staleTime: 60_000,
  });
  const sessionQ = useQuery({
    queryKey: ["session"],
    queryFn: () => api<SessionView>("GET", "/v1/p/session").catch((e) => (onSessionError(e), Promise.reject(e))),
    enabled: inSession,
  });
  const ordersQ = useQuery({
    queryKey: ["orders"],
    queryFn: () => api<OrderView[]>("GET", "/v1/p/orders"),
    enabled: inSession,
  });
  const billQ = useQuery({
    queryKey: ["bill"],
    queryFn: () => api<BillView>("GET", "/v1/p/bill"),
    enabled: inSession && tab === "bill",
  });

  // ── Realtime: events → targeted refetch; reconnect → full resync ──
  const resync = useCallback(() => {
    void qc.invalidateQueries();
  }, [qc]);
  const refreshOrders = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["orders"] });
    void qc.invalidateQueries({ queryKey: ["bill"] });
  }, [qc]);
  const { online } = useSessionSocket(inSession ? phase.guestToken : null, resync, (s) => {
    s.on("cart:updated", (e) => qc.setQueryData<SessionView>(["session"], (cur) => (cur ? { ...cur, cart: e.cart } : cur)));
    s.on("session:guest_joined", () => void qc.invalidateQueries({ queryKey: ["session"] }));
    s.on("order:placed", refreshOrders);
    s.on("order:cancelled", refreshOrders);
    s.on("item:status_changed", refreshOrders);
    s.on("session:confirmed", refreshOrders);
    s.on("bill:updated", () => void qc.invalidateQueries({ queryKey: ["bill"] }));
    s.on("item:out_of_stock", () => {
      refreshOrders();
      setToast(t("itemRanOut"));
      setTab("orders");
    });
    s.on("menu:item_availability", (e) =>
      qc.setQueryData<PublicMenu>(["menu"], (m) => (m ? { ...m, items: m.items.map((i) => (i.id === e.menuItemId ? { ...i, isAvailable: e.isAvailable } : i)) } : m)),
    );
    s.on("request:acknowledged", () => setToast(t("waiterComing")));
    s.on("bill:paid", (e) => setPhase({ kind: "paid", receiptUrl: e.receiptUrl }));
  });

  // ── Actions ──
  const errorText = (e: unknown, fallback: string) => (isBusyPaying(e) ? t("someonePaying") : e instanceof Error ? e.message : fallback);

  async function addToCart(l: AddLine) {
    try {
      const s = await api<SessionView>("PUT", `/v1/p/cart/items/${newClientId()}`, l);
      qc.setQueryData(["session"], s);
      setToast(t("addedToCart"));
    } catch (e) {
      setToast(errorText(e, t("couldNotAdd")));
      throw e;
    }
  }

  async function request(type: RequestType) {
    try {
      await api("POST", "/v1/p/requests", { clientId: newClientId(), type });
      setToast(t(`req${type}`));
      if (type === "BILL") setTab("bill");
    } catch (e) {
      setToast(errorText(e, t("couldNotSend")));
    }
  }

  /** Run an order action with one busy flag; errors become a toast. */
  async function act(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof PaymentCancelled)) setToast(errorText(e, fallback));
      else setToast(t("paymentCancelled"));
    } finally {
      setBusy(false);
      refreshOrders();
    }
  }

  const payOrder = (o: OrderView) =>
    act(async () => {
      await payByUpi({ kind: "ORDER", orderId: o.id });
      setToast(t("orderPaid"));
    }, t("payFailed"));

  // ── Screens ──
  if (phase.kind === "boot") return <Skeleton />;
  if (phase.kind === "join") return <Join lookup={phase.lookup} qrToken={qrToken} onJoined={enter} />;
  if (phase.kind === "ended") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-8 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-(--sunken) text-brand">
          <RotateCcw className="h-7 w-7" aria-hidden />
        </span>
        <h1 className="mt-5 text-lg font-semibold">{phase.message}</h1>
        <Button className="mt-6 px-8" onClick={() => location.reload()}>
          {t("startAgain")}
        </Button>
      </main>
    );
  }
  if (phase.kind === "paid") {
    const share = phase.receiptUrl ? `https://wa.me/?text=${encodeURIComponent(`${initialMenu.hotel.name}: ${phase.receiptUrl}`)}` : null;
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="grid h-20 w-20 animate-pop place-items-center rounded-full bg-veg/12 text-veg">
          <CheckCircle2 className="h-11 w-11" aria-hidden />
        </span>
        <h1 className="font-display text-3xl font-semibold">{t("thankYou")}</h1>
        <p className="muted max-w-xs">{t("paidThanks", { name: initialMenu.hotel.name })}</p>
        {phase.receiptUrl && (
          <div className="mt-4 flex w-full flex-col gap-2.5">
            <a
              href={phase.receiptUrl}
              className="tap flex items-center justify-center rounded-2xl bg-brand px-4 font-semibold text-brand-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_20px_-10px_var(--color-brand)]"
            >
              {t("viewReceipt")}
            </a>
            {share && (
              <a href={share} target="_blank" rel="noreferrer" className="tap line surface flex items-center justify-center gap-2 rounded-2xl border px-4 font-semibold">
                <MessageCircle className="h-4 w-4 text-veg" aria-hidden />
                {t("shareWhatsApp")}
              </a>
            )}
          </div>
        )}
      </main>
    );
  }

  const menu = menuQ.data;
  const session = sessionQ.data;
  const cart = session?.cart;
  const orders = ordersQ.data ?? [];

  return (
    <div className="mx-auto max-w-md px-4 md:max-w-3xl md:px-6">
      <Toast message={toast} onDone={clearToast} />
      {!online && (
        <div role="status" className="sticky top-0 z-30 -mx-4 flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-sm font-medium text-black md:-mx-6">
          <WifiOff className="h-4 w-4" aria-hidden />
          {t("reconnecting")}
        </div>
      )}

      <header className="flex items-start justify-between gap-3 pt-5 md:pt-8">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[26px] leading-tight font-semibold md:text-4xl">{menu.hotel.name}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
            <Pill className="bg-brand/10 text-brand">{t("table", { label: session?.tableLabel ?? "" })}</Pill>
            {session?.joinCode && (
              <Pill>
                <span className="muted font-medium">{t("code")}</span> <strong className="tracking-[0.2em]">{session.joinCode}</strong>
              </Pill>
            )}
          </p>
        </div>
        <LangPicker />
      </header>

      <nav className="mt-4 mb-2 grid grid-cols-3 gap-1 rounded-2xl bg-(--sunken) p-1" aria-label="Sections">
        {(["menu", "orders", "bill"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-current={tab === k}
            className={`h-10 rounded-xl text-sm font-semibold transition ${tab === k ? "surface text-(--ink) shadow-soft" : "muted"}`}
          >
            {k === "menu" ? t("tabMenu") : k === "orders" ? `${t("tabOrders")}${orders.length ? ` (${orders.length})` : ""}` : t("tabBill")}
          </button>
        ))}
      </nav>

      {tab === "menu" && <Menu menu={menu} onAdd={addToCart} />}
      {tab === "orders" && (
        <Orders
          orders={orders}
          actions={{
            busy,
            onRemove: (i) => act(() => api("POST", `/v1/p/order-items/${i.id}/remove`), t("couldNotSend")),
            onSwap: setSwapping,
            onPay: payOrder,
            onCancel: (o) => act(() => api("POST", `/v1/p/orders/${o.id}/cancel`), t("couldNotSend")),
          }}
        />
      )}
      {tab === "bill" && (
        <Bill
          bill={billQ.data}
          upiEnabled={menu.hotel.upiEnabled}
          onRequestBill={() => request("BILL")}
          onLeave={() =>
            act(async () => {
              const r = await api<{ receiptUrl: string }>("POST", "/v1/p/session/leave");
              setPhase({ kind: "paid", receiptUrl: r.receiptUrl });
            }, t("couldNotSend"))
          }
          onPaid={(receiptUrl) => {
            if (receiptUrl) setPhase({ kind: "paid", receiptUrl });
            else void qc.invalidateQueries({ queryKey: ["bill"] }); // paid one split; others still to pay
          }}
        />
      )}

      {/* Bottom bar: cart + always-available actions */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 bg-linear-to-t from-(--bg) from-60% to-transparent pt-8">
        <div className="pointer-events-auto mx-auto max-w-md space-y-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:max-w-3xl md:px-6">
          {cart && cart.items.length > 0 && (
            <Button className="h-14 w-full justify-between! rounded-2xl pr-5 pl-3 text-base" onClick={() => setCartOpen(true)}>
              <span className="flex items-center gap-3">
                <span className="grid h-9 min-w-9 place-items-center rounded-xl bg-white/20 px-2" aria-hidden>
                  <ShoppingBag className="h-5 w-5" />
                </span>
                <span className="text-left leading-tight">
                  <span className="block text-xs font-medium opacity-85">{t("items", { n: cart.items.reduce((n, i) => n + i.quantity, 0) })}</span>
                  <span className="block font-bold">{rupees(cart.subtotal)}</span>
                </span>
              </span>
              <span>{t("viewCart")}</span>
            </Button>
          )}
          <div className="surface line grid grid-cols-3 gap-1 rounded-2xl border p-1 shadow-lift">
            <Button variant="ghost" className="rounded-xl px-1 text-sm" onClick={() => request("CALL_WAITER")}>
              {t("btnWaiter")}
            </Button>
            <Button variant="ghost" className="rounded-xl px-1 text-sm" onClick={() => request("WATER")}>
              {t("btnWater")}
            </Button>
            <Button variant="ghost" className="rounded-xl px-1 text-sm" onClick={() => request("BILL")}>
              {t("btnBill")}
            </Button>
          </div>
        </div>
      </div>

      {cart && session && (
        <CartSheet
          open={cartOpen}
          onClose={() => setCartOpen(false)}
          session={session}
          menu={menu}
          onPlaced={async (order) => {
            setCartOpen(false);
            setTab("orders");
            void qc.invalidateQueries({ queryKey: ["orders"] });
            if (order.status === "AWAITING_PAYMENT") await payOrder(order);
            else setToast(t("orderSent"));
          }}
        />
      )}

      {swapping && (
        <SwapSheet
          menu={menu}
          title={t("swapTitle", { name: swapping.name })}
          quantity={swapping.quantity}
          onClose={() => setSwapping(null)}
          onPick={async (l) => {
            try {
              await api("POST", `/v1/p/order-items/${swapping.id}/replace`, { clientId: newClientId(), itemId: l.itemId, variantId: l.variantId, addonIds: l.addonIds });
              setSwapping(null);
              setToast(t("orderSent"));
              refreshOrders();
            } catch (e) {
              setToast(errorText(e, t("couldNotSend")));
              throw e;
            }
          }}
        />
      )}
    </div>
  );
}

function CartSheet({
  open,
  onClose,
  session,
  menu,
  onPlaced,
}: {
  open: boolean;
  onClose: () => void;
  session: SessionView;
  menu: PublicMenu;
  onPlaced: (order: OrderView) => void;
}) {
  const qc = useQueryClient();
  const { lang, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per checkout attempt: retries after a timeout can't create a second order.
  const checkoutId = useRef<string>(newClientId());
  const items = session.cart.items;
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const { allowPayNow, allowPayLater } = menu.hotel;

  async function setQty(id: string, quantity: number) {
    const line = items.find((i) => i.id === id);
    if (!line) return;
    const s =
      quantity <= 0
        ? await api<SessionView>("DELETE", `/v1/p/cart/items/${id}`)
        : await api<SessionView>("PUT", `/v1/p/cart/items/${id}`, { itemId: line.itemId, variantId: line.variantId, addonIds: line.addonIds, quantity, note: line.note });
    qc.setQueryData(["session"], s);
  }

  async function checkout(payment: "PAY_LATER" | "PAY_NOW") {
    setBusy(true);
    setError(null);
    try {
      const order = await api<OrderView>("POST", "/v1/p/orders", { clientId: checkoutId.current, payment });
      checkoutId.current = newClientId();
      void qc.invalidateQueries({ queryKey: ["session"] });
      onPlaced(order);
    } catch (e) {
      if (e instanceof ApiError && e.code !== "ITEM_UNAVAILABLE") {
        setError(e.message);
      } else {
        checkoutId.current = newClientId(); // cart must change before retrying
        setError(e instanceof Error ? e.message : "Could not place order");
      }
    } finally {
      setBusy(false);
    }
  }

  const blocked = busy || items.some((i) => !i.isValid);
  return (
    <Sheet open={open} onClose={onClose} title={t("cartTitle")}>
      {items.length === 0 ? (
        <p className="muted py-8 text-center">{t("cartEmpty")}</p>
      ) : (
        <>
          <ul className="line divide-y divide-(--line)">
            {items.map((i) => {
              const m = byId.get(i.itemId);
              return (
                <li key={i.id} className={`py-3.5 ${i.isValid ? "" : "opacity-60"}`}>
                  <div className="flex justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold">
                        {m && <FoodMark type={m.foodType} />}
                        {m ? tName(m, lang) : i.name}
                        {i.variantName ? ` (${i.variantName})` : ""}
                      </p>
                      <p className="muted text-xs">
                        {i.addonNames.join(", ")}
                        {i.note ? ` · “${i.note}”` : ""} · {t("addedBy", { name: i.guestName })}
                      </p>
                      {!i.isValid && <p className="mt-1 text-xs font-medium text-red-600">{t("noLongerAvailable")}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                      <p className="font-semibold tabular-nums">{rupees(i.lineTotal)}</p>
                      <div className="mt-1.5 inline-flex items-center rounded-xl border border-brand/30 bg-brand/5 font-bold text-brand">
                        <button className="h-9 w-9 text-lg" aria-label={`Fewer ${i.name}`} onClick={() => setQty(i.id, i.quantity - 1)}>
                          −
                        </button>
                        <span className="w-6 text-center tabular-nums">{i.quantity}</span>
                        <button className="h-9 w-9 text-lg disabled:opacity-40" aria-label={`More ${i.name}`} disabled={!i.isValid} onClick={() => setQty(i.id, i.quantity + 1)}>
                          +
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="muted mt-3 rounded-xl bg-(--sunken) px-3 py-2 text-xs">
            {t("sharedCart")} {menu.hotel.pricesIncludeTax ? t("pricesInclTax") : t("taxesAdded")}
          </p>
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm font-medium text-red-600">
              {error}
            </p>
          )}
          {allowPayNow && (
            <>
              <Button className="mt-5 h-14 w-full text-base" disabled={blocked} onClick={() => checkout("PAY_NOW")}>
                {busy ? t("sending") : `${t("payNowBtn")} · ${rupees(session.cart.subtotal)}`}
              </Button>
              <p className="muted mt-2 text-center text-xs">{t("payNowHint")}</p>
            </>
          )}
          {allowPayLater && (
            <>
              <Button variant={allowPayNow ? "outline" : "primary"} className="mt-4 h-14 w-full text-base" disabled={blocked} onClick={() => checkout("PAY_LATER")}>
                {busy ? t("sending") : allowPayNow ? t("orderPayLater") : t("placeOrder", { amount: rupees(session.cart.subtotal) })}
              </Button>
              <p className="muted mt-2 text-center text-xs">{t("payLaterHint")}</p>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

function Skeleton() {
  return (
    <div className="mx-auto max-w-md animate-pulse space-y-4 p-4 pt-6 md:max-w-3xl" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-2/3 rounded-lg bg-(--sunken)" />
      <div className="h-5 w-1/3 rounded-full bg-(--sunken)" />
      <div className="h-12 rounded-2xl bg-(--sunken)" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-3 py-2">
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/2 rounded bg-(--sunken)" />
            <div className="h-3 w-1/4 rounded bg-(--sunken)" />
            <div className="h-3 w-3/4 rounded bg-(--sunken)" />
          </div>
          <div className="h-24 w-28 rounded-2xl bg-(--sunken)" />
        </div>
      ))}
    </div>
  );
}
