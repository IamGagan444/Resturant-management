"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillView, OrderItemView, OrderView, PublicMenu, RequestType, SessionView, TableLookup } from "@rms/contracts";
import { ApiError, api, deviceId, newClientId } from "@/lib/api";
import { LangProvider, useI18n } from "@/lib/i18n";
import { useSessionSocket } from "@/lib/realtime";
import { FlyContext, flyTo, useCountUp, type FlySource } from "@/lib/motion";
import { PaymentCancelled, isBusyPaying, payByUpi } from "@/lib/upi";
import { Join, type Joined } from "./Join";
import { AllParcel, Menu, SwapSheet, tName, type AddLine } from "./Menu";
import { Orders } from "./Orders";
import { ParcelStatus, forgetPaid, recallPaid, rememberPaid, waitingParcels } from "./ParcelStatus";
import { Bill } from "./Bill";
import { Check, CheckCircle2, ClipboardList, ConciergeBell, GlassWater, MessageCircle, ReceiptText, RotateCcw, ShoppingBag, UtensilsCrossed, WifiOff, type LucideIcon } from "lucide-react";
import { Button, FoodMark, HeaderTools, Pill, Sheet, Toast, rupees, usePlace, type ToastMsg, type ToastTone } from "./ui";

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
  | { kind: "ended"; message: string; badQr?: boolean };
type Tab = "menu" | "orders" | "bill";
const REQUEST_COOLDOWN_MS = 20_000;
const TAB_ICON: Record<Tab, LucideIcon> = { menu: UtensilsCrossed, orders: ClipboardList, bill: ReceiptText };
/** Same width for the page, its sticky bars and the bottom bar: phone column, wider on tablets and desktops. */
const COLUMN = "mx-auto max-w-md px-4 md:max-w-3xl md:px-6 lg:max-w-5xl xl:max-w-6xl";

function Inner({ initialMenu, qrToken }: { initialMenu: PublicMenu; qrToken: string }) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: "boot" });
  const [tab, setTab] = useState<Tab>("menu");
  const [cartOpen, setCartOpen] = useState(false);
  const [swapping, setSwapping] = useState<OrderItemView | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToastState] = useState<ToastMsg | null>(null);
  /** a new id each time, so the same message twice in a row still shows again */
  const setToast = useCallback((text: string, tone: ToastTone = "ok") => setToastState({ id: Date.now(), text, tone }), []);
  const clearToast = useCallback(() => setToastState(null), []);
  const inSession = phase.kind === "in";
  const place = usePlace();

  // ── Boot: same phone rejoins silently; new phone sees the join screen ──
  useEffect(() => {
    (async () => {
      // paid, but a parcel is still coming: the page was closed or reloaded, so show its status again
      const paid = recallPaid(qrToken);
      if (paid) {
        const orders = await api<OrderView[]>("GET", "/v1/p/orders").catch(() => []);
        if (waitingParcels(orders).length) return setPhase({ kind: "paid", receiptUrl: paid.receiptUrl });
        forgetPaid();
      }
      try {
        const lookup = await api<TableLookup>("GET", `/v1/p/t/${qrToken}?deviceId=${deviceId()}`);
        const name = localStorage.getItem("rms.name");
        if (lookup.isMember && name) {
          const j = await api<Joined>("POST", "/v1/p/sessions/join", { qrToken, deviceId: deviceId(), name });
          enter(j);
        } else setPhase({ kind: "join", lookup });
      } catch (e) {
        setPhase({ kind: "ended", message: e instanceof Error ? e.message : "Could not open this table", badQr: e instanceof ApiError && e.code === "QR_INVALID" });
      }
    })();
    // Runs once per QR; `enter` only touches stable setters.
  }, [qrToken]);

  useEffect(() => {
    if (phase.kind === "paid") rememberPaid(qrToken, phase.receiptUrl);
  }, [phase, qrToken]);

  function enter(j: Joined) {
    forgetPaid();
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
      setToast(t("itemRanOut"), "warn");
      setTab("orders");
    });
    s.on("menu:item_availability", (e) =>
      qc.setQueryData<PublicMenu>(["menu"], (m) => (m ? { ...m, items: m.items.map((i) => (i.id === e.menuItemId ? { ...i, isAvailable: e.isAvailable } : i)) } : m)),
    );
    s.on("request:acknowledged", () => setToast(t("waiterComing"), "info"));
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
      setToast(errorText(e, t("couldNotAdd")), "error");
      throw e;
    }
  }

  /**
   * − / + on a dish card (dishes without sizes or add-ons). Changes the newest plain line of that dish in the shared
   * cart, or adds one; the quantity is taken from the server's cart, like the cart sheet does.
   */
  async function stepItem(itemId: string, delta: 1 | -1) {
    const lines = (sessionQ.data?.cart.items ?? []).filter((l) => l.itemId === itemId && l.isValid);
    const plain = lines.filter((l) => !l.addonIds.length && !l.note && !l.variantId);
    const line = delta > 0 ? plain.at(-1) : (plain.at(-1) ?? lines.at(-1));
    try {
      if (!line) {
        if (delta > 0) await addToCart({ itemId, variantId: null, addonIds: [], quantity: 1, note: null, isParcel: sessionQ.data?.isParcel ?? false });
        return;
      }
      const quantity = line.quantity + delta;
      const s =
        quantity <= 0
          ? await api<SessionView>("DELETE", `/v1/p/cart/items/${line.id}`)
          : await api<SessionView>("PUT", `/v1/p/cart/items/${line.id}`, {
              itemId: line.itemId,
              variantId: line.variantId,
              addonIds: line.addonIds,
              quantity,
              note: line.note,
              isParcel: line.isParcel,
            });
      qc.setQueryData(["session"], s);
    } catch (e) {
      if (line) setToast(errorText(e, t("couldNotSend")), "error"); // addToCart already said why
    }
  }

  // Impatient repeat taps on "Call waiter" shouldn't ring the staff phones again and stack duplicate requests.
  const lastRequest = useRef<Partial<Record<RequestType, number>>>({});
  // the button that was just used shows a tick for a moment, besides the toast
  const [sent, setSent] = useState<RequestType | null>(null);
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(null), 2500);
    return () => clearTimeout(id);
  }, [sent]);
  async function request(type: RequestType) {
    const now = Date.now();
    if (now - (lastRequest.current[type] ?? 0) < REQUEST_COOLDOWN_MS) {
      setToast(t(`req${type}`), "info"); // same reassurance, no second request
      if (type === "BILL") setTab("bill");
      return;
    }
    lastRequest.current[type] = now;
    try {
      await api("POST", "/v1/p/requests", { clientId: newClientId(), type });
      setSent(type);
      setToast(t(`req${type}`), "info");
      if (type === "BILL") setTab("bill");
    } catch (e) {
      lastRequest.current[type] = 0; // it didn't go through: let them try again right away
      setToast(errorText(e, t("couldNotSend")), "error");
    }
  }

  /** Run an order action with one busy flag; errors become a toast. */
  async function act(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof PaymentCancelled)) setToast(errorText(e, fallback), "error");
      else setToast(t("paymentCancelled"), "warn");
    } finally {
      setBusy(false);
      refreshOrders();
    }
  }

  const payOrder = (o: OrderView) =>
    act(async () => {
      const { receiptUrl } = await payByUpi({ kind: "ORDER", orderId: o.id });
      setToast(t("orderPaid"));
      if (receiptUrl) setPhase({ kind: "paid", receiptUrl }); // walk-in parcel: paid is done, the food follows
    }, t("payFailed"));

  // ── Fly to cart: the cart button may only appear with this very add, so wait two frames for it to mount ──
  const cartButton = useRef<HTMLSpanElement>(null);
  const bottomBar = useRef<HTMLDivElement>(null);
  const fly = useCallback((from: FlySource | null) => {
    requestAnimationFrame(() => requestAnimationFrame(() => flyTo(from, cartButton.current ?? bottomBar.current)));
  }, []);
  const cartItems = sessionQ.data?.cart.items;
  const inCart = useMemo(() => {
    const byItem = new Map<string, number>();
    for (const l of cartItems ?? []) byItem.set(l.itemId, (byItem.get(l.itemId) ?? 0) + l.quantity);
    return byItem;
  }, [cartItems]);
  const shownSubtotal = useCountUp(sessionQ.data?.cart.subtotal ?? 0, 450, 100);

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
        {phase.badQr && (
          <a href="/" className="tap mt-2 inline-flex items-center px-5 font-medium text-brand underline">
            {t("typeTableCode")}
          </a>
        )}
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
        <h1 className="font-display text-3xl font-bold">{t("thankYou")}</h1>
        <p className="muted max-w-xs">{t("paidThanks", { name: initialMenu.hotel.name })}</p>
        <ParcelStatus onOrderAgain={() => (forgetPaid(), location.reload())} />
        {phase.receiptUrl && (
          <div className="mt-4 flex w-full flex-col gap-2.5">
            <a
              href={phase.receiptUrl}
              className="tap flex items-center justify-center rounded-full bg-brand px-5 font-medium text-brand-ink"
            >
              {t("viewReceipt")}
            </a>
            {share && (
              <a href={share} target="_blank" rel="noreferrer" className="tap flex items-center justify-center gap-2 rounded-full bg-(--sunken) px-5 font-medium">
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
    <div className={COLUMN}>
      <Toast message={toast} onDone={clearToast} />
      {!online && (
        <div role="status" className="sticky top-0 z-30 -mx-4 flex items-center justify-center gap-2 bg-warn px-4 py-1.5 text-center text-sm font-medium text-warn-ink md:-mx-6">
          <WifiOff className="h-4 w-4" aria-hidden />
          {t("reconnecting")}
        </div>
      )}

      <header className="flex items-start justify-between gap-3 pt-5 md:pt-8">
        <div className="min-w-0">
          <h1 className="font-display line-clamp-2 text-[28px] leading-[1.1] font-bold tracking-tight text-balance md:text-4xl lg:text-[44px]">{menu.hotel.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
            <Pill className="bg-brand/10 text-brand">{session ? place(session.tableLabel) : "…"}</Pill>
            {session?.joinCode && (
              <Pill>
                <span className="muted font-medium">{t("code")}</span> <strong className="tracking-[0.2em]">{session.joinCode}</strong>
              </Pill>
            )}
          </p>
        </div>
        <HeaderTools />
      </header>

      <nav className="relative mt-5 mb-1 grid grid-cols-3 gap-1 rounded-2xl bg-(--sunken) p-1 md:max-w-md" aria-label="Sections">
        {/* one pill that slides to the chosen tab (transform only: cheap on any phone) */}
        <span
          aria-hidden
          className="surface absolute inset-y-1 left-1 w-[calc((100%-1rem)/3)] rounded-xl shadow-soft transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]"
          style={{ transform: `translateX(calc(${["menu", "orders", "bill"].indexOf(tab)} * (100% + 0.25rem)))` }}
        />
        {(["menu", "orders", "bill"] as const).map((k) => {
          const Icon = TAB_ICON[k];
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-current={tab === k}
              className={`relative flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-semibold transition-colors duration-200 ${tab === k ? "text-(--ink)" : "muted"}`}
            >
              <Icon className={`h-4 w-4 shrink-0 transition-colors duration-200 ${tab === k ? "text-brand" : ""}`} aria-hidden />
              <span className="relative truncate">
                {k === "menu" ? t("tabMenu") : k === "orders" ? `${t("tabOrders")}${orders.length ? ` (${orders.length})` : ""}` : t("tabBill")}
              </span>
            </button>
          );
        })}
      </nav>

      {tab === "menu" && (
        <AllParcel.Provider value={session?.isParcel ?? false}>
          <FlyContext.Provider value={fly}>
            <Menu menu={menu} onAdd={addToCart} onStep={stepItem} inCart={inCart} />
          </FlyContext.Provider>
        </AllParcel.Provider>
      )}
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
      {/* Glass: the menu stays visible underneath. Colour (the cart) sits on a solid layer so its text stays legible. */}
      <div ref={bottomBar} className="pointer-events-none fixed inset-x-0 bottom-0 z-30 pt-6">
        <div className="pointer-events-auto mx-auto max-w-md space-y-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:max-w-xl md:px-6">
          {cart && cart.items.length > 0 && (
            <div className="animate-rise">
              <Button className="h-14 w-full justify-between! pr-6 pl-2.5 text-base shadow-[0_12px_28px_-10px_var(--color-brand)]" onClick={() => setCartOpen(true)}>
                <span className="flex items-center gap-3">
                  <span ref={cartButton} className="grid h-10 min-w-10 place-items-center rounded-xl bg-white/20 px-2" aria-hidden>
                    <ShoppingBag className="h-5 w-5" />
                  </span>
                  <span className="text-left leading-tight">
                    <span className="block text-xs font-medium opacity-85">
                      {(() => {
                        const n = cart.items.reduce((sum, i) => sum + i.quantity, 0);
                        return n === 1 ? t("oneItem") : t("items", { n });
                      })()}
                    </span>
                    <span className="block font-bold tabular-nums">{rupees(shownSubtotal)}</span>
                  </span>
                </span>
                <span>{t("viewCart")}</span>
              </Button>
            </div>
          )}
          <div
            className={`line grid ${session?.isParcel ? "grid-cols-2" : "grid-cols-3"} gap-1 rounded-2xl border bg-(--surface)/75 p-1 shadow-lift backdrop-blur-lg backdrop-saturate-150`}
          >
            <ActionButton icon={ConciergeBell} done={sent === "CALL_WAITER"} onClick={() => request("CALL_WAITER")}>
              {t("btnWaiter")}
            </ActionButton>
            {!session?.isParcel && (
              <ActionButton icon={GlassWater} done={sent === "WATER"} onClick={() => request("WATER")}>
                {t("btnWater")}
              </ActionButton>
            )}
            <ActionButton icon={ReceiptText} done={sent === "BILL"} onClick={() => request("BILL")}>
              {t("btnBill")}
            </ActionButton>
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
              setToast(errorText(e, t("couldNotSend")), "error");
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
  // Lines with an update in flight. Their buttons wait for the answer: the next tap's quantity is computed from the
  // server's cart, so quick taps on + can't all send the same number (and the cart is shared with the table).
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per checkout attempt: retries after a timeout can't create a second order.
  const checkoutId = useRef<string>(newClientId());
  const items = session.cart.items;
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const { allowPayNow, allowPayLater } = menu.hotel;

  async function change(line: (typeof items)[number], patch: { quantity?: number; isParcel?: boolean }) {
    const quantity = patch.quantity ?? line.quantity;
    setError(null);
    setPending((p) => new Set(p).add(line.id));
    try {
      const s =
        quantity <= 0
          ? await api<SessionView>("DELETE", `/v1/p/cart/items/${line.id}`)
          : await api<SessionView>("PUT", `/v1/p/cart/items/${line.id}`, {
              itemId: line.itemId,
              variantId: line.variantId,
              addonIds: line.addonIds,
              quantity,
              note: line.note,
              isParcel: patch.isParcel ?? line.isParcel,
            });
      qc.setQueryData(["session"], s);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("couldNotSend"));
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(line.id);
        return next;
      });
    }
  }

  async function parcelAll(isParcel: boolean) {
    setBusy(true);
    for (const line of items) if (line.isValid && line.isParcel !== isParcel) await change(line, { isParcel });
    setBusy(false);
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

  const blocked = busy || pending.size > 0 || items.some((i) => !i.isValid);
  return (
    <Sheet open={open} onClose={onClose} title={t("cartTitle")}>
      {items.length === 0 ? (
        <p className="muted py-8 text-center">{t("cartEmpty")}</p>
      ) : (
        <>
          <label className={`tap cursor-pointer items-center justify-between gap-3 rounded-2xl bg-(--sunken) px-4 text-sm font-bold ${session.isParcel ? "hidden" : "flex"}`}>
            {t("parcelAll")}
            <input
              type="checkbox"
              className="h-5 w-5 accent-brand"
              checked={items.every((i) => i.isParcel || !i.isValid)}
              disabled={busy || !items.some((i) => i.isValid)}
              onChange={(e) => void parcelAll(e.target.checked)}
            />
          </label>
          <ul className="line divide-y divide-(--line)">
            {items.map((i) => {
              const m = byId.get(i.itemId);
              const waiting = pending.has(i.id);
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
                      <label className={`mt-2 ${session.isParcel ? "hidden" : "inline-flex"} h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-xs font-semibold ${i.isParcel ? "border-brand bg-brand/10 text-brand" : "line"}`}>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-brand"
                          aria-label={`${t("parcel")}: ${i.name}`}
                          checked={i.isParcel}
                          disabled={!i.isValid || busy || waiting}
                          onChange={(e) => change(i, { isParcel: e.target.checked })}
                        />
                        {t("parcel")}
                      </label>
                      {!i.isValid && <p className="mt-1 text-xs font-medium text-late">{t("noLongerAvailable")}</p>}
                    </div>
                    <div className="flex shrink-0 flex-col items-end">
                      <p className="font-semibold tabular-nums">{rupees(i.lineTotal)}</p>
                      <div className="mt-1.5 inline-flex items-center rounded-xl border border-brand/30 bg-brand/5 font-bold text-brand" aria-busy={waiting || undefined}>
                        <button className="h-9 w-9 text-lg disabled:opacity-40" aria-label={`Fewer ${i.name}`} disabled={waiting} onClick={() => change(i, { quantity: i.quantity - 1 })}>
                          −
                        </button>
                        <span className={`w-6 text-center tabular-nums ${waiting ? "opacity-50" : ""}`}>{i.quantity}</span>
                        <button className="h-9 w-9 text-lg disabled:opacity-40" aria-label={`More ${i.name}`} disabled={!i.isValid || waiting} onClick={() => change(i, { quantity: i.quantity + 1 })}>
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
            {session.isParcel ? t("parcelHint") + "." : t("sharedCart")} {menu.hotel.pricesIncludeTax ? t("pricesInclTax") : t("taxesAdded")}
          </p>
          {error && (
            <p role="alert" className="mt-3 rounded-xl bg-late/10 px-3 py-2 text-sm font-medium text-late">
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
    <div className="mx-auto max-w-md animate-pulse space-y-4 p-4 pt-6 md:max-w-3xl lg:max-w-5xl xl:max-w-6xl" aria-busy="true" aria-label="Loading">
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

/** Waiter / water / bill: icon over label, a tick for a moment after the request went through. */
function ActionButton({ icon: Icon, done, onClick, children }: { icon: LucideIcon; done: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[13px] font-semibold transition duration-150 select-none active:scale-[0.97] active:bg-(--sunken) ${
        done ? "text-veg" : ""
      }`}
    >
      {done ? <Check key="done" className="h-5 w-5 animate-pop" aria-hidden /> : <Icon key="icon" className="h-5 w-5" aria-hidden />}
      <span className="max-w-full truncate">{children}</span>
    </button>
  );
}
