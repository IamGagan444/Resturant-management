"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OrderView } from "@rms/contracts";
import { PackageCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button, usePlace } from "./ui";

const KEY = "rms.paid";
const KEEP_MS = 12 * 3600_000;

/** Remembered on this phone, so closing the page while waiting for a parcel doesn't lose it. */
export function rememberPaid(qrToken: string, receiptUrl: string | null) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ qrToken, receiptUrl, at: Date.now() }));
  } catch {
    // private mode: the status just won't survive a reload
  }
}
export function forgetPaid() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing stored
  }
}
export function recallPaid(qrToken: string): { receiptUrl: string | null } | null {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? "null") as { qrToken: string; receiptUrl: string | null; at: number } | null;
    return p && p.qrToken === qrToken && Date.now() - p.at < KEEP_MS ? p : null;
  } catch {
    return null;
  }
}

/** Parcel dishes not handed over yet. */
export const waitingParcels = (orders: OrderView[]) =>
  orders
    .filter((o) => o.status !== "AWAITING_PAYMENT" && o.status !== "CANCELLED")
    .flatMap((o) => o.items.map((item) => ({ item, order: o })))
    .filter(({ item }) => item.isParcel && item.status !== "SERVED" && item.status !== "CANCELLED");

/** After paying: is the parcel ready yet? The table session is over, so this polls instead of using the live socket. */
export function ParcelStatus({ onOrderAgain }: { onOrderAgain: () => void }) {
  const { t } = useI18n();
  const place = usePlace();
  const [seen, setSeen] = useState(false); // there was a parcel to wait for
  const orders = useQuery({
    queryKey: ["paid-orders"],
    queryFn: () => api<OrderView[]>("GET", "/v1/p/orders"),
    refetchInterval: (q) => (q.state.data && waitingParcels(q.state.data).length === 0 ? false : 8_000),
    refetchOnWindowFocus: true,
  });
  const waiting = waitingParcels(orders.data ?? []);
  const ready = waiting.length > 0 && waiting.every(({ item }) => item.status === "READY" || item.status === "PICKED_UP");

  useEffect(() => {
    if (waiting.length) setSeen(true);
  }, [waiting.length]);
  const buzzed = useRef(false);
  useEffect(() => {
    if (!ready || buzzed.current) return;
    buzzed.current = true;
    if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
  }, [ready]);

  const first = waiting[0];
  if (!first) {
    return seen ? (
      <>
        <p role="status" className="font-semibold text-veg">{t("parcelHandedOver")}</p>
        <Button variant="outline" onClick={onOrderAgain}>{t("orderAgain")}</Button>
      </>
    ) : null;
  }
  return (
    <section className={`mt-2 w-full rounded-3xl border p-5 text-left ${ready ? "border-veg bg-veg/10" : "line surface"}`}>
      <p className="flex items-center justify-between gap-3">
        <span className="font-display text-3xl font-bold">{place(first.order.tableLabel)}</span>
        <PackageCheck className={`h-8 w-8 ${ready ? "text-veg" : "text-brand"}`} aria-hidden />
      </p>
      <p role="status" className={`mt-1 font-semibold ${ready ? "text-veg" : ""}`}>{ready ? t("parcelReady") : t("parcelCooking")}</p>
      <ul className="mt-3 space-y-1.5 text-sm">
        {waiting.map(({ item }) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span>
              <b>{item.quantity} ×</b> {item.name}
              {item.variantName ? ` (${item.variantName})` : ""}
            </span>
            <span className="muted shrink-0">
              {item.status === "OUT_OF_STOCK" ? t("soldOut") : item.status === "READY" || item.status === "PICKED_UP" ? t("stepReady") : item.status === "COOKING" ? t("stepCooking") : t("stepReceived")}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted mt-3 text-xs">{t("parcelKeepOpen")}</p>
    </section>
  );
}
