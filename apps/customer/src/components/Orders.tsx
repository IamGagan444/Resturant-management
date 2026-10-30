"use client";

import type { OrderItemView, OrderView } from "@rms/contracts";
import { trackerStep, type TrackerStep } from "@rms/domain";
import { useI18n, type MsgKey } from "@/lib/i18n";
import { Button, rupees } from "./ui";

const STEPS: { key: TrackerStep; label: MsgKey }[] = [
  { key: "RECEIVED", label: "stepReceived" },
  { key: "COOKING", label: "stepCooking" },
  { key: "READY", label: "stepReady" },
  { key: "ON_THE_WAY", label: "stepOnTheWay" },
  { key: "SERVED", label: "stepServed" },
];

export interface OrderActions {
  onRemove: (item: OrderItemView) => void;
  onSwap: (item: OrderItemView) => void;
  onPay: (order: OrderView) => void;
  onCancel: (order: OrderView) => void;
  busy: boolean;
}

export function Orders({ orders, actions }: { orders: OrderView[]; actions: OrderActions }) {
  const { t } = useI18n();
  if (orders.length === 0) return <p className="muted py-16 text-center">{t("noOrders")}</p>;
  return (
    <div className="space-y-4 pb-40">
      {[...orders].reverse().map((o) => (
        <article key={o.id} className="surface line rounded-2xl border p-4">
          <header className="mb-3 flex items-baseline justify-between">
            <h3 className="font-semibold">{t("orderNo", { n: o.orderNumber })}</h3>
            <OrderBadge order={o} />
          </header>
          {o.status === "PENDING_CONFIRMATION" && <p className="mb-3 rounded-lg bg-amber-500/15 p-2 text-sm">{t("waiterWillConfirm")}</p>}
          {o.status === "AWAITING_PAYMENT" && (
            <div className="mb-3 space-y-2 rounded-lg bg-amber-500/15 p-2 text-sm">
              <p>{t("awaitingPayment")}</p>
              <div className="flex gap-2">
                <Button className="flex-1" disabled={actions.busy} onClick={() => actions.onPay(o)}>
                  {t("payNow")}
                </Button>
                <Button variant="outline" disabled={actions.busy} onClick={() => actions.onCancel(o)}>
                  {t("cancelOrder")}
                </Button>
              </div>
            </div>
          )}
          <ul className="space-y-3">
            {o.items.map((i) => (
              <ItemRow key={i.id} item={i} held={o.status === "AWAITING_PAYMENT"} actions={actions} />
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function OrderBadge({ order }: { order: OrderView }) {
  const { t } = useI18n();
  if (order.status === "SERVED") return <span className="text-sm text-veg">{t("served")}</span>;
  if (order.status === "CANCELLED") return <span className="muted text-sm">{t("cancelled")}</span>;
  if (!order.etaAt || order.status === "AWAITING_PAYMENT") return null;
  const min = Math.max(0, Math.round((new Date(order.etaAt).getTime() - Date.now()) / 60_000));
  return <span className="muted text-sm">{min > 0 ? t("mins", { n: min }) : t("anyMoment")}</span>;
}

function ItemRow({ item, held, actions }: { item: OrderItemView; held: boolean; actions: OrderActions }) {
  const { t } = useI18n();
  const step = trackerStep(item.status);
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <li>
      <div className="flex justify-between gap-2">
        <span className={step === "CANCELLED" ? "muted line-through" : ""}>
          {item.quantity} × {item.name}
          {item.variantName ? ` (${item.variantName})` : ""}
        </span>
        <span className="muted text-sm">{rupees(item.unitPrice * item.quantity)}</span>
      </div>
      {step === "OUT_OF_STOCK" ? (
        <div className="mt-2 space-y-2 rounded-lg bg-red-500/10 p-2 text-sm">
          <p>{t("ranOut")}</p>
          <div className="flex gap-2">
            <Button className="flex-1 text-sm" disabled={actions.busy} onClick={() => actions.onSwap(item)}>
              {t("swap")}
            </Button>
            <Button variant="outline" className="text-sm" disabled={actions.busy} onClick={() => actions.onRemove(item)}>
              {t("remove")}
            </Button>
          </div>
        </div>
      ) : step === "CANCELLED" || held ? null : (
        <ol className="mt-2 flex gap-1" aria-label={STEPS[idx] ? t(STEPS[idx].label) : step}>
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= idx ? "bg-brand" : "bg-stone-300 dark:bg-stone-700"}`} />
              <span className={`mt-1 block text-[10px] ${i === idx ? "font-semibold" : "muted"}`}>{t(s.label)}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
