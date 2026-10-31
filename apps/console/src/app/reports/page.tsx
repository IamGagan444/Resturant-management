"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DayReport } from "@rms/contracts";
import { api, rupees } from "@/lib/api";
import { useGuard } from "@/lib/auth";
import { ArrowLeft, IndianRupee, Printer, ReceiptText, RefreshCw, ShoppingBag, TrendingUp } from "lucide-react";
import { Button, Card, CardHeader, ErrorText, NavLink, Stat, TopBar } from "@/components/ui";
import { CardSkeleton, StatsSkeleton } from "@/components/ui/skeleton";

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
      <TopBar title="Day report" subtitle={me.hotel.name}>
        <NavLink href={isManager ? "/manage/" : "/cashier/"} icon={ArrowLeft}>
          Back
        </NavLink>
      </TopBar>
      <main className="mx-auto max-w-5xl space-y-5 px-3 py-5 sm:px-6 sm:py-8">
        <div className="no-print flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-semibold">Business day</span>
            <input type="date" value={date || r?.date || ""} onChange={(e) => setDate(e.target.value)} />
          </label>
          <span className="flex-1" />
          <Button variant="outline" onClick={() => void report.refetch()}>
            <RefreshCw className={`h-4 w-4 ${report.isFetching ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden />
            Print
          </Button>
        </div>
        <ErrorText error={report.error} />
        {report.isLoading && (
          <div className="space-y-5">
            <StatsSkeleton />
            <CardSkeleton lines={5} />
          </div>
        )}

        {r && (
          <>
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {new Date(`${r.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </h2>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Net sales" value={rupees(r.bills.total)} icon={IndianRupee} />
              <Stat label="Bills" value={String(r.bills.count)} icon={ReceiptText} />
              <Stat label="Average bill" value={rupees(r.bills.averageBill)} icon={TrendingUp} />
              <Stat label="Orders" value={`${r.orders.count}`} hint={`${r.orders.qr} QR · ${r.orders.waiter} waiter`} icon={ShoppingBag} />
            </div>

            <Card>
              <CardHeader title="Sales (settled bills)" />
              <dl className="space-y-1 text-sm">
                <Row k="Menu value" v={rupees(r.bills.subtotal)} />
                <Row k="Discounts" v={`−${rupees(r.bills.discount)}`} />
                <Row k="Service charge" v={rupees(r.bills.serviceCharge)} />
                {r.taxLines.map((t) => (
                  <Row key={t.name + t.rateBps} k={`${t.name} ${pct(t.rateBps)} on ${rupees(t.taxable)}`} v={rupees(t.amount)} />
                ))}
                <Row k="Round off" v={rupees(r.bills.roundOff)} />
                <div className="line mt-2 flex justify-between border-t pt-2 text-base font-bold">
                  <dt>Total</dt>
                  <dd>{rupees(r.bills.total)}</dd>
                </div>
              </dl>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader title="Money received" />
                {r.payments.length === 0 && <p className="muted text-sm">No payments.</p>}
                <dl className="space-y-1 text-sm">
                  {r.payments.map((p) => (
                    <Row key={p.method} k={`${METHOD[p.method] ?? p.method} (${p.count})`} v={rupees(p.amount)} />
                  ))}
                  <div className="line mt-2 flex justify-between border-t pt-2 text-base font-bold">
                    <dt>Total</dt>
                    <dd>{rupees(r.payments.reduce((s, p) => s + p.amount, 0))}</dd>
                  </div>
                </dl>
                {r.open.sessions > 0 && (
                  <p className="mt-3 rounded-xl bg-warn/12 p-3 text-sm font-medium">
                    {r.open.sessions} table{r.open.sessions > 1 ? "s" : ""} still open · {rupees(r.open.due)} not yet collected
                  </p>
                )}
              </Card>
              <Card>
                <CardHeader title="Top items" />
                <ol className="space-y-2 text-sm">
                  {r.topItems.map((i, n) => (
                    <li key={i.name} className="flex items-center gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-(--sunken) text-xs font-bold">{n + 1}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">{i.quantity} ×</span> {i.name}
                      </span>
                      <span className="muted tabular-nums">{rupees(i.amount)}</span>
                    </li>
                  ))}
                </ol>
                <p className="muted mt-3 text-xs">
                  {r.orders.cancelledItems} cancelled · {r.orders.outOfStockItems} out of stock
                </p>
              </Card>
            </div>

            {r.discounts.length > 0 && (
              <Card>
                <CardHeader title="Discounts given" />
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 py-0.5">
      <dt className="muted">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
