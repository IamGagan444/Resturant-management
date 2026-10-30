"use client";

import { useState } from "react";
import type { BillView, StartUpiPaymentInput } from "@rms/contracts";
import { useI18n } from "@/lib/i18n";
import { PaymentCancelled, isBusyPaying, payByUpi } from "@/lib/upi";
import { Button, rupees } from "./ui";

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

export function Bill({
  bill,
  upiEnabled,
  onRequestBill,
  onLeave,
  onPaid,
}: {
  bill: BillView | undefined;
  upiEnabled: boolean;
  onRequestBill: () => void;
  onLeave: () => void;
  onPaid: (receiptUrl: string | null) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!bill) return <p className="muted py-16 text-center">{t("loadingBill")}</p>;
  if (bill.lines.length === 0) return <p className="muted py-16 text-center">{t("nothingOnBill")}</p>;

  async function pay(target: StartUpiPaymentInput["target"]) {
    setBusy(true);
    setError(null);
    try {
      onPaid((await payByUpi(target)).receiptUrl);
    } catch (e) {
      setError(e instanceof PaymentCancelled ? t("paymentCancelled") : isBusyPaying(e) ? t("someonePaying") : e instanceof Error ? e.message : t("payFailed"));
    } finally {
      setBusy(false);
    }
  }

  const unpaidSplits = bill.splits.filter((s) => !s.isPaid);
  const prepaid = bill.status !== "PAID" && bill.due === 0 && bill.paid > 0; // everything paid up front (pay-now)

  return (
    <div className="pb-40">
      <article className="surface line rounded-2xl border p-4">
        <h3 className="mb-3 font-semibold">{t("table", { label: bill.tableLabel })}</h3>
        <ul className="space-y-1 text-sm">
          {bill.lines.map((l) => (
            <li key={l.orderItemId} className="flex justify-between gap-2">
              <span>
                {l.quantity} × {l.name}
                {l.variantName ? ` (${l.variantName})` : ""}
              </span>
              <span>{rupees(l.amount)}</span>
            </li>
          ))}
        </ul>
        <dl className="line mt-3 space-y-1 border-t pt-3 text-sm">
          <Row label={t("subtotal")} value={bill.subtotal} />
          {bill.discount > 0 && <Row label={t("discount")} value={-bill.discount} />}
          {bill.serviceCharge > 0 && <Row label={t("serviceCharge", { pct: pct(bill.serviceChargeBps) })} value={bill.serviceCharge} />}
          {bill.taxLines.map((tl) => (
            <Row key={`${tl.name}${tl.rateBps}`} label={`${tl.name} ${pct(tl.rateBps)}`} value={tl.amount} />
          ))}
          {bill.roundOff !== 0 && <Row label={t("roundOff")} value={bill.roundOff} />}
          <div className="flex justify-between pt-2 text-lg font-bold">
            <dt>{t("total")}</dt>
            <dd>{rupees(bill.total)}</dd>
          </div>
          {bill.paid > 0 && <Row label={t("paid")} value={-bill.paid} />}
        </dl>
      </article>

      {bill.status === "PAID" ? (
        <p className="mt-6 text-center text-lg font-semibold text-veg">{t("paidThankYou")}</p>
      ) : prepaid ? (
        <div className="mt-6 space-y-3 text-center">
          <p>{t("allPaid")}</p>
          <Button className="w-full text-lg" onClick={onLeave}>
            {t("doneLeaving")}
          </Button>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {bill.paymentInFlight && !busy && (
            <p role="status" className="rounded-lg bg-amber-500/15 p-2 text-sm">
              {t("someonePaying")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {unpaidSplits.length > 0 ? (
            <section aria-label={t("billSplit")} className="space-y-2">
              <h4 className="font-semibold">{t("billSplit")}</h4>
              {bill.splits.map((s) =>
                s.isPaid ? (
                  <div key={s.id} className="line flex justify-between rounded-xl border px-4 py-3 text-sm">
                    <span>{s.label}</span>
                    <span className="text-veg">{t("partPaid")}</span>
                  </div>
                ) : (
                  <Button
                    key={s.id}
                    className="w-full"
                    disabled={busy || !upiEnabled}
                    onClick={() => pay({ kind: "BILL", billId: bill.id, splitId: s.id })}
                  >
                    {t("payPart", { label: s.label, amount: rupees(s.amount - s.paid) })}
                  </Button>
                ),
              )}
            </section>
          ) : (
            upiEnabled && (
              <Button className="w-full text-lg" disabled={busy || bill.due <= 0} onClick={() => pay({ kind: "BILL", billId: bill.id })}>
                {busy ? t("openingUpi") : t("payByUpi", { amount: rupees(bill.due) })}
              </Button>
            )
          )}
          <Button variant="outline" className="w-full" onClick={onRequestBill}>
            {t("payAtTable")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="muted">{label}</dt>
      <dd>{value < 0 ? `−${rupees(-value)}` : rupees(value)}</dd>
    </div>
  );
}
