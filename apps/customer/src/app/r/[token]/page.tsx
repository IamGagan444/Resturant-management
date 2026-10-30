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
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-semibold">Bill not found</h1>
        <p className="muted mt-2">The link may be incomplete. Ask the restaurant to send it again.</p>
      </main>
    );
  }
  const { bill, hotel } = r;
  const when = r.closedAt ? new Date(r.closedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: hotel.timezone }) : "";
  return (
    <main className="mx-auto max-w-md p-4 print:p-0">
      <article className="surface line rounded-2xl border p-5 print:border-0">
        <header className="text-center">
          <h1 className="text-xl font-bold">{hotel.name}</h1>
          {hotel.address && <p className="muted text-sm">{hotel.address}</p>}
          {hotel.phone && <p className="muted text-sm">{hotel.phone}</p>}
          {hotel.gstin && <p className="text-sm">GSTIN {hotel.gstin}</p>}
          <p className="mt-3 text-sm font-semibold tracking-wide uppercase">Tax invoice</p>
        </header>
        <dl className="line mt-4 grid grid-cols-2 gap-y-1 border-y py-2 text-sm">
          <dt className="muted">Bill no.</dt>
          <dd className="text-right font-mono">{bill.billNumber}</dd>
          <dt className="muted">Date</dt>
          <dd className="text-right">{when}</dd>
          <dt className="muted">Table</dt>
          <dd className="text-right">{bill.tableLabel}</dd>
        </dl>
        <table className="mt-3 w-full text-sm">
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
                <td className="py-0.5">
                  {l.name}
                  {l.variantName ? ` (${l.variantName})` : ""}
                  {l.addons.length > 0 && <span className="muted block text-xs">{l.addons.join(", ")}</span>}
                </td>
                <td className="text-right">{l.quantity}</td>
                <td className="text-right">{rupees(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="line mt-3 space-y-1 border-t pt-3 text-sm">
          <Row label="Subtotal" value={rupees(bill.subtotal)} />
          {bill.discount > 0 && <Row label="Discount" value={`−${rupees(bill.discount)}`} />}
          {bill.serviceCharge > 0 && <Row label={`Service charge ${pct(bill.serviceChargeBps)}`} value={rupees(bill.serviceCharge)} />}
          {bill.taxLines.map((t) => (
            <Row key={`${t.name}${t.rateBps}`} label={`${t.name} ${pct(t.rateBps)} on ${rupees(t.taxable)}`} value={rupees(t.amount)} />
          ))}
          {bill.roundOff !== 0 && <Row label="Round off" value={bill.roundOff < 0 ? `−${rupees(-bill.roundOff)}` : rupees(bill.roundOff)} />}
          <div className="flex justify-between pt-2 text-lg font-bold">
            <dt>Total</dt>
            <dd>{rupees(bill.total)}</dd>
          </div>
          {bill.pricesIncludeTax && <p className="muted text-xs">Prices include GST.</p>}
        </dl>
        <p className="muted mt-3 text-sm">Paid by {r.payments.map((p) => `${METHOD[p.method]} ${rupees(p.amount)}`).join(" + ")}</p>
        <p className="mt-4 text-center text-sm">Thank you for dining with us!</p>
      </article>
      <PrintButton />
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
