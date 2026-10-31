import type { Metadata } from "next";
import type { ReceiptView } from "@rms/contracts";
import { formatPaise } from "@rms/domain";
import { PrintButton } from "./PrintButton";

/** Digital GST invoice behind a signed link (shared on WhatsApp / SMS). Server-rendered, no client JS except Print. */
async function getReceipt(token: string): Promise<ReceiptView | null> {
  const res = await fetch(`${process.env.API_URL ?? "http://localhost:4000"}/v1/r/${encodeURIComponent(token)}`, { cache: "no-store" });
  if (!res.ok) return null;
  return res.json() as Promise<ReceiptView>;
}

export const metadata: Metadata = { title: "Your bill", robots: { index: false, follow: false } };

const rupees = (paise: number) => formatPaise(paise).replace(/\.00$/, "");
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
const METHOD = { UPI: "UPI", CASH: "Cash", CARD: "Card", ROOM_CHARGE: "Room" } as const;

export default async function ReceiptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await getReceipt(token);
  if (!r) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center p-8 text-center">
        <h1 className="font-display text-2xl font-semibold">Bill not found</h1>
        <p className="muted mt-2">The link may be incomplete. Ask the restaurant to send it again.</p>
      </main>
    );
  }
  const { bill, hotel } = r;
  const when = r.closedAt ? new Date(r.closedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: hotel.timezone }) : "";
  return (
    <main className="mx-auto max-w-md px-4 py-8 print:p-0">
      <article className="surface line overflow-hidden rounded-3xl border shadow-lift print:rounded-none print:border-0 print:shadow-none">
        <div className="h-1.5 bg-linear-to-r from-brand-2 to-brand print:hidden" aria-hidden />
        <div className="p-6">
        <header className="text-center">
          <h1 className="font-display text-2xl font-semibold">{hotel.name}</h1>
          {hotel.address && <p className="muted text-sm">{hotel.address}</p>}
          {hotel.phone && <p className="muted text-sm">{hotel.phone}</p>}
          {hotel.gstin && <p className="text-sm">GSTIN {hotel.gstin}</p>}
          <p className="mt-4 inline-block rounded-full bg-(--sunken) px-3 py-1 text-xs font-bold tracking-widest uppercase">Tax invoice</p>
        </header>
        <dl className="line mt-5 grid grid-cols-2 gap-y-1.5 border-y border-dashed py-3 text-sm">
          <dt className="muted">Bill no.</dt>
          <dd className="text-right font-mono">{bill.billNumber}</dd>
          <dt className="muted">Date</dt>
          <dd className="text-right">{when}</dd>
          <dt className="muted">Table</dt>
          <dd className="text-right">{bill.tableLabel}</dd>
        </dl>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="muted text-left text-xs">
              <th className="font-normal">Item</th>
              <th className="text-right font-normal">Qty</th>
              <th className="text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.lines.map((l) => (
              <tr key={l.orderItemId} className="align-top">
                <td className="py-1">
                  {l.name}
                  {l.variantName ? ` (${l.variantName})` : ""}
                  {l.addons.length > 0 && <span className="muted block text-xs">{l.addons.join(", ")}</span>}
                </td>
                <td className="text-right">{l.quantity}</td>
                <td className="text-right tabular-nums">{rupees(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="line mt-4 space-y-1.5 border-t border-dashed pt-4 text-sm">
          <Row label="Subtotal" value={rupees(bill.subtotal)} />
          {bill.discount > 0 && <Row label="Discount" value={`−${rupees(bill.discount)}`} />}
          {bill.serviceCharge > 0 && <Row label={`Service charge ${pct(bill.serviceChargeBps)}`} value={rupees(bill.serviceCharge)} />}
          {bill.taxLines.map((t) => (
            <Row key={`${t.name}${t.rateBps}`} label={`${t.name} ${pct(t.rateBps)} on ${rupees(t.taxable)}`} value={rupees(t.amount)} />
          ))}
          {bill.roundOff !== 0 && <Row label="Round off" value={bill.roundOff < 0 ? `−${rupees(-bill.roundOff)}` : rupees(bill.roundOff)} />}
          <div className="line flex justify-between border-t pt-3 text-xl font-extrabold">
            <dt>Total</dt>
            <dd>{rupees(bill.total)}</dd>
          </div>
          {bill.pricesIncludeTax && <p className="muted text-xs">Prices include GST.</p>}
        </dl>
        <p className="muted mt-4 rounded-xl bg-(--sunken) px-3 py-2 text-sm">Paid by {r.payments.map((p) => `${METHOD[p.method]} ${rupees(p.amount)}`).join(" + ")}</p>
        <p className="font-display mt-6 text-center text-lg font-semibold">Thank you for dining with us!</p>
        </div>
      </article>
      <PrintButton />
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
