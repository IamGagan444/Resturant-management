"use client";

import { useState } from "react";
import type { BillView, StartUpiPaymentInput } from "@rms/contracts";
import { useI18n } from "@/lib/i18n";
import { PaymentCancelled, isBusyPaying, payByUpi } from "@/lib/upi";
import { CheckCircle2, ReceiptText, Smartphone } from "lucide-react";
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

  if (!bill) return <p className="muted py-20 text-center">{t("loadingBill")}</p>;
  if (bill.lines.length === 0)
    return (
      <div className="muted flex flex-col items-center gap-3 py-20 text-center">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-(--sunken)">
          <ReceiptText className="h-7 w-7" aria-hidden />
        </span>
        <p>{t("nothingOnBill")}</p>
      </div>
    );

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
    <div className="mx-auto max-w-xl pt-2 pb-44">
      <article className="surface line overflow-hidden rounded-3xl border shadow-soft">
        <div className="h-1.5 bg-linear-to-r from-brand-2 to-brand" aria-hidden />
        <div className="p-5">
        <h3 className="mb-4 flex items-center gap-2 font-bold">
          <ReceiptText className="h-4.5 w-4.5 text-brand" aria-hidden />
          {t("table", { label: bill.tableLabel })}
        </h3>
        <ul className="space-y-2 text-sm">
          {bill.lines.map((l) => (
            <li key={l.orderItemId} className="flex justify-between gap-3">
              <span>
                {l.quantity} × {l.name}
                {l.variantName ? ` (${l.variantName})` : ""}
              </span>
              <span className="tabular-nums">{rupees(l.amount)}</span>
            </li>
          ))}
        </ul>
        <dl className="line mt-4 space-y-1.5 border-t border-dashed pt-4 text-sm">
          <Row label={t("subtotal")} value={bill.subtotal} />
          {bill.discount > 0 && <Row label={t("discount")} value={-bill.discount} />}
          {bill.serviceCharge > 0 && <Row label={t("serviceCharge", { pct: pct(bill.serviceChargeBps) })} value={bill.serviceCharge} />}
          {bill.taxLines.map((tl) => (
            <Row key={`${tl.name}${tl.rateBps}`} label={`${tl.name} ${pct(tl.rateBps)}`} value={tl.amount} />
          ))}
          {bill.roundOff !== 0 && <Row label={t("roundOff")} value={bill.roundOff} />}
          <div className="line flex justify-between border-t pt-3 text-xl font-extrabold">
            <dt>{t("total")}</dt>
            <dd className="tabular-nums">{rupees(bill.total)}</dd>
          </div>
          {bill.paid > 0 && <Row label={t("paid")} value={-bill.paid} />}
        </dl>
        </div>
      </article>

      {bill.status === "PAID" ? (
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-lg font-semibold text-veg">
          <CheckCircle2 className="h-5 w-5" aria-hidden />
          {t("paidThankYou")}
        </p>
      ) : prepaid ? (
        <div className="mt-6 space-y-3 text-center">
          <p className="font-medium">{t("allPaid")}</p>
          <Button className="h-14 w-full text-base" onClick={onLeave}>
            {t("doneLeaving")}
          </Button>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {bill.paymentInFlight && !busy && (
            <p role="status" className="rounded-2xl bg-amber-500/12 p-3 text-sm font-medium">
              {t("someonePaying")}
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-2xl bg-red-500/10 p-3 text-sm font-medium text-red-600">
              {error}
            </p>
          )}
          {unpaidSplits.length > 0 ? (
            <section aria-label={t("billSplit")} className="space-y-2">
              <h4 className="text-sm font-bold">{t("billSplit")}</h4>
              {bill.splits.map((s) =>
                s.isPaid ? (
                  <div key={s.id} className="line surface flex justify-between rounded-2xl border px-4 py-3 text-sm font-medium">
                    <span>{s.label}</span>
                    <span className="flex items-center gap-1 text-veg">
                      <CheckCircle2 className="h-4 w-4" aria-hidden />
                      {t("partPaid")}
                    </span>
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
              <Button className="h-14 w-full text-base" disabled={busy || bill.due <= 0} onClick={() => pay({ kind: "BILL", billId: bill.id })}>
                <Smartphone className="h-5 w-5" aria-hidden />
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
    <div className="flex justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd className="tabular-nums">{value < 0 ? `−${rupees(-value)}` : rupees(value)}</dd>
    </div>
  );
}
