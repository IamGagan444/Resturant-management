"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DayReport } from "@rms/contracts";
import { api, rupees } from "@/lib/api";
import { useGuard } from "@/lib/auth";
import { Button, Card, ErrorText, TopBar } from "@/components/ui";

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
const METHOD: Record<string, string> = { UPI: "UPI", CASH: "Cash", CARD: "Card", ROOM_CHARGE: "Room charge" };

/** End-of-day summary: sales (GST invoices), money received by method, items, discounts. Print for the day file. */
export default function ReportsPage() {
  const me = useGuard(["OWNER", "MANAGER", "CASHIER"]);
  const [date, setDate] = useState<string>("");
  const report = useQuery({
    queryKey: ["report", date],
    queryFn: () => api<DayReport>("GET", `/v1/s/reports/day${date ? `?date=${date}` : ""}`),
    enabled: Boolean(me),
  });
  if (!me || me.typ !== "staff") return null;
  const r = report.data;
  const isManager = me.role === "OWNER" || me.role === "MANAGER";

  return (
    <div className="min-h-dvh">
      <TopBar title="Day report">
        <a href={isManager ? "/manage/" : "/cashier/"} className="muted text-sm underline">
          Back
        </a>
      </TopBar>
      <main className="mx-auto max-w-3xl space-y-4 p-4">
        <div className="no-print flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Business day</span>
            <input type="date" value={date || r?.date || ""} onChange={(e) => setDate(e.target.value)} />
          </label>
          <Button variant="outline" onClick={() => void report.refetch()}>
            Refresh
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            🖨 Print
          </Button>
        </div>
        <ErrorText error={report.error} />

        {r && (
          <>
            <h2 className="text-xl font-black">
              {me.hotel.name} · {new Date(`${r.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Net sales" value={rupees(r.bills.total)} />
              <Stat label="Bills" value={String(r.bills.count)} />
              <Stat label="Average bill" value={rupees(r.bills.averageBill)} />
              <Stat label="Orders" value={`${r.orders.count}`} hint={`${r.orders.qr} QR · ${r.orders.waiter} waiter`} />
            </div>

            <Card>
              <h3 className="mb-2 font-bold">Sales (settled bills)</h3>
              <dl className="space-y-1 text-sm">
                <Row k="Menu value" v={rupees(r.bills.subtotal)} />
                <Row k="Discounts" v={`−${rupees(r.bills.discount)}`} />
                <Row k="Service charge" v={rupees(r.bills.serviceCharge)} />
                {r.taxLines.map((t) => (
                  <Row key={t.name + t.rateBps} k={`${t.name} ${pct(t.rateBps)} on ${rupees(t.taxable)}`} v={rupees(t.amount)} />
                ))}
                <Row k="Round off" v={rupees(r.bills.roundOff)} />
                <div className="line flex justify-between border-t pt-1 font-bold">
                  <dt>Total</dt>
                  <dd>{rupees(r.bills.total)}</dd>
                </div>
              </dl>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <h3 className="mb-2 font-bold">Money received</h3>
                {r.payments.length === 0 && <p className="muted text-sm">No payments.</p>}
                <dl className="space-y-1 text-sm">
                  {r.payments.map((p) => (
                    <Row key={p.method} k={`${METHOD[p.method] ?? p.method} (${p.count})`} v={rupees(p.amount)} />
                  ))}
                  <div className="line flex justify-between border-t pt-1 font-bold">
                    <dt>Total</dt>
                    <dd>{rupees(r.payments.reduce((s, p) => s + p.amount, 0))}</dd>
                  </div>
                </dl>
                {r.open.sessions > 0 && (
                  <p className="mt-2 rounded-lg bg-warn/15 p-2 text-sm">
                    {r.open.sessions} table{r.open.sessions > 1 ? "s" : ""} still open · {rupees(r.open.due)} not yet collected
                  </p>
                )}
              </Card>
              <Card>
                <h3 className="mb-2 font-bold">Top items</h3>
                <ol className="space-y-1 text-sm">
                  {r.topItems.map((i) => (
                    <li key={i.name} className="flex justify-between gap-2">
                      <span>
                        {i.quantity} × {i.name}
                      </span>
                      <span className="muted">{rupees(i.amount)}</span>
                    </li>
                  ))}
                </ol>
                <p className="muted mt-2 text-xs">
                  {r.orders.cancelledItems} cancelled · {r.orders.outOfStockItems} out of stock
                </p>
              </Card>
            </div>

            {r.discounts.length > 0 && (
              <Card>
                <h3 className="mb-2 font-bold">Discounts given</h3>
                <ul className="space-y-1 text-sm">
                  {r.discounts.map((d, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        <span className="font-mono">{d.billNumber}</span> <span className="muted">{d.reason ?? "no reason"}</span>
                      </span>
                      <span>{rupees(d.amount)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="surface line rounded-2xl border p-3">
      <p className="muted text-xs">{label}</p>
      <p className="text-xl font-black">{value}</p>
      {hint && <p className="muted text-xs">{hint}</p>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
