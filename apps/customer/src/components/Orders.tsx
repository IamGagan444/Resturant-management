"use client";

import type { OrderItemView, OrderView } from "@rms/contracts";
import { trackerStep, type TrackerStep } from "@rms/domain";
import { useI18n, type MsgKey } from "@/lib/i18n";
import { Clock, ReceiptText } from "lucide-react";
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
  if (orders.length === 0)
    return (
      <div className="muted flex flex-col items-center gap-3 py-20 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-(--sunken)">
          <ReceiptText className="h-7 w-7" aria-hidden />
        </span>
        <p>{t("noOrders")}</p>
      </div>
    );
  return (
    <div className="space-y-4 pt-2 pb-44 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
      {[...orders].reverse().map((o) => (
        <article key={o.id} className="surface line rounded-3xl border p-4 shadow-soft sm:p-5">
          <header className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold">{t("orderNo", { n: o.orderNumber })}</h3>
            <OrderBadge order={o} />
          </header>
          {o.status === "PENDING_CONFIRMATION" && <p className="mb-4 rounded-2xl bg-amber-500/12 p-3 text-sm font-medium">{t("waiterWillConfirm")}</p>}
          {o.status === "AWAITING_PAYMENT" && (
            <div className="mb-4 space-y-3 rounded-2xl bg-amber-500/12 p-3 text-sm font-medium">
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
          <ul className="space-y-4">
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
  if (order.status === "SERVED") return <span className="rounded-full bg-veg/12 px-2.5 py-1 text-xs font-bold text-veg">{t("served")}</span>;
  if (order.status === "CANCELLED") return <span className="muted rounded-full bg-(--sunken) px-2.5 py-1 text-xs font-bold">{t("cancelled")}</span>;
  if (!order.etaAt || order.status === "AWAITING_PAYMENT") return null;
  const min = Math.max(0, Math.round((new Date(order.etaAt).getTime() - Date.now()) / 60_000));
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-xs font-bold text-brand">
      <Clock className="h-3.5 w-3.5" aria-hidden />
      {min > 0 ? t("mins", { n: min }) : t("anyMoment")}
    </span>
  );
}

function ItemRow({ item, held, actions }: { item: OrderItemView; held: boolean; actions: OrderActions }) {
  const { t } = useI18n();
  const step = trackerStep(item.status);
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <li>
      <div className="flex justify-between gap-3">
        <span className={`font-medium ${step === "CANCELLED" ? "muted line-through" : ""}`}>
          <span className="font-bold">{item.quantity} ×</span> {item.name}
          {item.variantName ? ` (${item.variantName})` : ""}
        </span>
        <span className="muted text-sm tabular-nums">{rupees(item.unitPrice * item.quantity)}</span>
      </div>
      {step === "OUT_OF_STOCK" ? (
        <div className="mt-2 space-y-2 rounded-2xl bg-red-500/10 p-3 text-sm font-medium">
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
        <ol className="mt-2.5 flex gap-1" aria-label={STEPS[idx] ? t(STEPS[idx].label) : step}>
          {STEPS.map((s, i) => (
            <li key={s.key} className="min-w-0 flex-1">
              <div className={`h-1.5 rounded-full transition-colors ${i < idx ? "bg-brand" : i === idx ? "animate-pulse bg-brand" : "bg-(--line)"}`} />
              <span className={`mt-1.5 block truncate text-[10px] leading-tight ${i === idx ? "font-bold text-brand" : "muted"}`}>{t(s.label)}</span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
