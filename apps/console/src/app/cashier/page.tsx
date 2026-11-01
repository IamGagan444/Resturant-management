"use client";

import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillView, SendBillResult, SplitBillInput } from "@rms/contracts";
import { api, newClientId, rupees, toPaise } from "@/lib/api";
import { useGuard } from "@/lib/auth";
import { chime, unlockSound, useStaffSocket } from "@/lib/realtime";
import { ArrowLeft, BarChart3, Banknote, Bell, CheckCircle2, CreditCard, MessageCircle, Printer, ReceiptText, Smartphone } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorText, Field, NavLink, OfflineBanner, TopBar } from "@/components/ui";
import { QueryError } from "@/components/ui/feedback";
import { ListSkeleton } from "@/components/ui/skeleton";

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/** Counter: every live table's running bill. Collect in one tap (amount defaults to what's due). */
export default function CashierPage() {
  const me = useGuard(["CASHIER", "MANAGER", "OWNER"]);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  // the bill just settled here stays on screen so the digital bill can be sent
  const [settled, setSettled] = useState<BillView | null>(null);
  const bills = useQuery({ queryKey: ["bills"], queryFn: () => api<BillView[]>("GET", "/v1/s/bills/live"), enabled: Boolean(me), refetchInterval: 30_000 });
  const refetch = useCallback(() => void qc.invalidateQueries({ queryKey: ["bills"] }), [qc]);
  const { online } = useStaffSocket(Boolean(me), refetch, (s) => {
    s.on("bill:requested", () => (chime("alert"), refetch()));
    for (const ev of ["bill:paid", "bill:updated", "order:placed", "item:status_changed", "order:cancelled"] as const) s.on(ev, refetch);
  });
  if (!me) return null;
  const list = bills.data ?? [];
  const bill = list.find((b) => b.id === selected) ?? null;
  const open = Boolean(settled || bill);

  const onChange = (b?: BillView) => {
    if (b?.status === "PAID") setSettled(b);
    refetch();
  };

  return (
    <div className="min-h-dvh">
      <TopBar title="Counter" online={online}>
        <NavLink href="/reports/" icon={BarChart3}>
          Day report
        </NavLink>
        <Button variant="ghost" className="px-0" aria-label="Turn on sound alerts" title="Turn on sound alerts" onClick={() => (unlockSound(), chime())}>
          <Bell className="h-5 w-5" aria-hidden />
        </Button>
      </TopBar>
      <OfflineBanner online={online} />
      <div className="mx-auto grid max-w-7xl gap-5 px-3 py-4 sm:px-6 sm:py-6 md:grid-cols-[minmax(280px,1fr)_1.35fr] md:items-start">
        <section className={`no-print md:sticky md:top-20 ${open ? "hidden md:block" : ""}`} aria-label="Open bills">
          <h2 className="muted mb-3 flex items-center justify-between text-xs font-bold tracking-wider uppercase">
            Open bills
            <span className="rounded-full bg-(--sunken) px-2 py-0.5 tabular-nums">{list.length}</span>
          </h2>
          {bills.isLoading && <ListSkeleton rows={4} />}
          {bills.isError && !bills.data && <QueryError error={bills.error} onRetry={() => void bills.refetch()} retrying={bills.isFetching} />}
          {bills.isSuccess && list.length === 0 && <EmptyState icon={ReceiptText} title="No open bills." hint="Tables appear here as soon as guests order." />}
          <ul className="space-y-2">
            {list.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => (setSelected(b.id), setSettled(null))}
                  aria-current={b.id === selected}
                  className={`surface flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left shadow-soft transition hover:border-brand/40 ${
                    b.id === selected ? "border-brand ring-2 ring-brand/20" : "line"
                  }`}
                >
                  <span className="grid h-12 min-w-12 shrink-0 place-items-center rounded-xl bg-brand/10 px-2 text-lg font-extrabold text-brand">{b.tableLabel}</span>
                  <span className="min-w-0 flex-1">
                    <span className="muted block text-sm">{b.lines.length} items</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {b.splits.length > 0 && <Badge tone="brand">split</Badge>}
                      {b.paymentInFlight && <Badge tone="warn">UPI…</Badge>}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-lg font-extrabold tabular-nums">{rupees(b.due)}</span>
                    {b.paid > 0 && <span className="muted text-xs">paid {rupees(b.paid)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <div className={open ? "" : "hidden md:block"}>
          {open && (
            <button
              className="no-print muted mb-3 inline-flex h-10 items-center gap-1.5 rounded-xl pr-3 text-sm font-semibold hover:text-(--ink) md:hidden"
              onClick={() => (setSelected(null), setSettled(null))}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              All tables
            </button>
          )}
          {settled ? (
            <SettledPanel bill={settled} onDone={() => (setSettled(null), setSelected(null))} />
          ) : bill ? (
            <BillPanel key={bill.id} bill={bill} onChange={onChange} />
          ) : (
            <div className="line rounded-2xl border border-dashed">
              <EmptyState icon={ReceiptText} title="Select a table" hint="Its running bill, payments and split options show here." />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BillPanel({ bill, onChange }: { bill: BillView; onChange: (b?: BillView) => void }) {
  const [amount, setAmount] = useState((bill.due / 100).toString());
  const [discount, setDiscount] = useState(bill.discount ? (bill.discount / 100).toString() : "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function run(p: () => Promise<BillView | unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await p();
      onChange(r && typeof r === "object" && "status" in r ? (r as BillView) : undefined);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const collect = (method: "CASH" | "CARD", paise: number, splitId?: string) =>
    run(() => api<BillView>("POST", "/v1/s/payments", { clientId: newClientId(), billId: bill.id, splitId, method, amount: paise }));
  const split = (input: SplitBillInput) => run(() => api<BillView>("POST", `/v1/s/bills/${bill.id}/split`, input));
  const prepaid = bill.due === 0 && bill.paid > 0;
  const unpaidSplits = bill.splits.filter((s) => !s.isPaid);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold tracking-tight">Table {bill.tableLabel}</h2>
        <Badge className="capitalize">{bill.status.replace("_", " ").toLowerCase()}</Badge>
      </div>
      <ul className="mt-4 space-y-1.5">
        {bill.lines.map((l) => (
          <li key={l.orderItemId} className="flex justify-between gap-3">
            <span className="min-w-0">
              {l.quantity} × {l.name}
              {l.variantName ? ` (${l.variantName})` : ""}
              {l.guestName && <span className="muted text-xs"> · {l.guestName}</span>}
            </span>
            <span className="tabular-nums">{rupees(l.amount)}</span>
          </li>
        ))}
      </ul>
      <dl className="line mt-4 space-y-1 rounded-xl border border-dashed bg-(--sunken)/50 p-3 text-sm">
        <Row k="Subtotal" v={rupees(bill.subtotal)} />
        {bill.discount > 0 && <Row k="Discount" v={`−${rupees(bill.discount)}`} />}
        {bill.serviceCharge > 0 && <Row k={`Service charge ${pct(bill.serviceChargeBps)}`} v={rupees(bill.serviceCharge)} />}
        {bill.taxLines.map((t) => (
          <Row key={t.name + t.rateBps} k={`${t.name} ${pct(t.rateBps)}`} v={rupees(t.amount)} />
        ))}
        {bill.roundOff !== 0 && <Row k="Round off" v={`${bill.roundOff < 0 ? "−" : ""}${rupees(Math.abs(bill.roundOff))}`} />}
        <div className="line mt-1 flex justify-between border-t pt-2 text-xl font-extrabold">
          <dt>Total</dt>
          <dd className="tabular-nums">{rupees(bill.total)}</dd>
        </div>
        {bill.paid > 0 && <Row k="Paid" v={rupees(bill.paid)} />}
        <div className="flex justify-between text-lg font-bold text-brand tabular-nums">
          <dt>Due</dt>
          <dd>{rupees(bill.due)}</dd>
        </div>
      </dl>

      <div className="no-print mt-5 space-y-3">
        {bill.paymentInFlight && (
          <p className="flex items-center gap-2 rounded-xl bg-warn/12 p-3 text-sm font-medium">
            <Smartphone className="h-4 w-4 shrink-0 text-warn" aria-hidden />A guest is paying by UPI right now. Wait for it to finish before taking cash.
          </p>
        )}

        {prepaid ? (
          <Button variant="success" className="w-full" disabled={busy} onClick={() => void run(() => api<BillView>("POST", `/v1/s/sessions/${bill.sessionId}/close`))}>
            <CheckCircle2 className="h-5 w-5" aria-hidden />
            Paid in full · close table
          </Button>
        ) : unpaidSplits.length > 0 ? (
          <section className="space-y-2" aria-label="Split parts">
            <h3 className="text-sm font-bold">Split · collect per part</h3>
            {bill.splits.map((s) => (
              <div key={s.id} className="line flex items-center gap-2 rounded-xl border p-2.5">
                <span className="flex-1 font-semibold">
                  {s.label}
                  <span className={`block text-sm font-medium ${s.isPaid ? "text-fresh" : "muted"}`}>{s.isPaid ? "paid" : `${rupees(s.amount - s.paid)} due`}</span>
                </span>
                {!s.isPaid && (
                  <>
                    <Button variant="success" aria-label={`Cash for ${s.label}`} disabled={busy || bill.paymentInFlight} onClick={() => void collect("CASH", s.amount - s.paid, s.id)}>
                      <Banknote className="h-5 w-5" aria-hidden />
                    </Button>
                    <Button aria-label={`Card for ${s.label}`} disabled={busy || bill.paymentInFlight} onClick={() => void collect("CARD", s.amount - s.paid, s.id)}>
                      <CreditCard className="h-5 w-5" aria-hidden />
                    </Button>
                  </>
                )}
              </div>
            ))}
            {bill.splits.every((s) => s.paid === 0) && (
              <Button variant="outline" className="w-full" disabled={busy} onClick={() => void split({ type: "NONE" })}>
                Undo split
              </Button>
            )}
          </section>
        ) : (
          <>
            <Field label="Collect amount (₹)">
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-lg font-semibold tabular-nums" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="success" className="h-14 text-base" disabled={busy || bill.due <= 0 || bill.paymentInFlight} onClick={() => void collect("CASH", toPaise(amount))}>
                <Banknote className="h-5 w-5" aria-hidden />
                Cash
              </Button>
              <Button className="h-14 text-base" disabled={busy || bill.due <= 0 || bill.paymentInFlight} onClick={() => void collect("CARD", toPaise(amount))}>
                <CreditCard className="h-5 w-5" aria-hidden />
                Card
              </Button>
            </div>
            {bill.due > 0 && <SplitControls bill={bill} busy={busy} onSplit={split} />}
          </>
        )}

        <details className="line rounded-xl border p-3 open:bg-(--sunken)/40">
          <summary className="cursor-pointer text-sm font-semibold">Discount / service charge</summary>
          <div className="mt-3 grid gap-2">
            <Field label="Discount (₹)">
              <input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
            <Field label="Reason">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. regular customer" />
            </Field>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => api<BillView>("PATCH", `/v1/s/bills/${bill.id}`, { discount: toPaise(discount), discountReason: reason || undefined }))}
            >
              Apply discount
            </Button>
            {bill.serviceCharge > 0 && (
              <Button variant="outline" disabled={busy} onClick={() => void run(() => api<BillView>("PATCH", `/v1/s/bills/${bill.id}`, { removeServiceCharge: true }))}>
                Remove service charge (guest request)
              </Button>
            )}
          </div>
        </details>
        <Button variant="outline" className="w-full" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden />
          Print
        </Button>
        <ErrorText error={error} />
      </div>
    </Card>
  );
}

/** Equal parts in one tap; by guest uses who ordered what; by item lets the cashier drop each line into a group. */
function SplitControls({ bill, busy, onSplit }: { bill: BillView; busy: boolean; onSplit: (i: SplitBillInput) => void }) {
  const [byItem, setByItem] = useState(false);
  const [groups, setGroups] = useState(2);
  const [assign, setAssign] = useState<Record<string, number>>({});
  const guests = new Set(bill.lines.map((l) => l.guestId ?? "shared")).size;

  if (byItem) {
    const groupOf = (id: string) => assign[id] ?? 0;
    return (
      <div className="line space-y-2 rounded-xl border p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Split by item</h3>
          <select aria-label="Number of groups" value={groups} onChange={(e) => setGroups(Number(e.target.value))}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n} people
              </option>
            ))}
          </select>
        </div>
        {bill.lines.map((l) => (
          <div key={l.orderItemId} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              {l.quantity} × {l.name}
            </span>
            <div className="flex gap-1" role="radiogroup" aria-label={`Who pays for ${l.name}`}>
              {Array.from({ length: groups }, (_, g) => (
                <button
                  key={g}
                  role="radio"
                  aria-checked={groupOf(l.orderItemId) === g}
                  onClick={() => setAssign((a) => ({ ...a, [l.orderItemId]: g }))}
                  className={`h-9 w-9 rounded-lg border font-semibold ${groupOf(l.orderItemId) === g ? "border-brand bg-brand text-brand-ink" : "line"}`}
                >
                  {String.fromCharCode(65 + g)}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() =>
              onSplit({
                type: "BY_ITEM",
                groups: Array.from({ length: groups }, (_, g) => ({
                  label: `Person ${String.fromCharCode(65 + g)}`,
                  orderItemIds: bill.lines.filter((l) => groupOf(l.orderItemId) === g).map((l) => l.orderItemId),
                })).filter((g) => g.orderItemIds.length > 0),
              })
            }
          >
            Split
          </Button>
          <Button variant="outline" onClick={() => setByItem(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <details className="line rounded-xl border p-3 open:bg-(--sunken)/40">
      <summary className="cursor-pointer text-sm font-semibold">Split bill</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {[2, 3, 4, 5].map((n) => (
          <Button key={n} variant="outline" disabled={busy} onClick={() => onSplit({ type: "EQUAL", parts: n })}>
            ÷ {n}
          </Button>
        ))}
        <Button variant="outline" disabled={busy || guests < 2} onClick={() => onSplit({ type: "BY_GUEST" })}>
          By guest
        </Button>
        <Button variant="outline" disabled={busy || bill.lines.length < 2} onClick={() => setByItem(true)}>
          By item
        </Button>
      </div>
    </details>
  );
}

/** After the last payment: hand over the digital bill (WhatsApp / SMS opens on this device, pre-filled). */
function SettledPanel({ bill, onDone }: { bill: BillView; onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [links, setLinks] = useState<SendBillResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function send() {
    setError(null);
    try {
      setLinks(await api<SendBillResult>("POST", `/v1/s/bills/${bill.id}/send`, { phone: phone.replace(/\s/g, "") }));
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Card>
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-fresh/12 text-fresh">
        <CheckCircle2 className="h-9 w-9" aria-hidden />
      </span>
      <h2 className="mt-3 text-center text-2xl font-extrabold tracking-tight">Table {bill.tableLabel} paid</h2>
      <p className="muted text-center">
        {bill.billNumber} · {rupees(bill.total)}
      </p>
      <div className="no-print mt-4 space-y-3">
        <Field label="Guest's mobile for the digital bill">
          <input type="tel" inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {links ? (
          <div className="grid grid-cols-2 gap-2">
            <a className="tap flex items-center justify-center gap-2 rounded-full bg-fresh px-5 font-medium text-white hover:opacity-90" href={links.whatsappUrl} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4" aria-hidden />
              WhatsApp
            </a>
            <a className="tap flex items-center justify-center rounded-full bg-(--sunken) px-5 font-medium hover:bg-(--line)" href={links.smsUrl}>
              SMS
            </a>
          </div>
        ) : (
          <Button className="w-full" disabled={phone.replace(/\D/g, "").length < 10} onClick={() => void send()}>
            Send bill
          </Button>
        )}
        {bill.receiptUrl && (
          <a className="muted block text-center text-sm underline" href={bill.receiptUrl} target="_blank" rel="noreferrer">
            Open bill
          </a>
        )}
        <ErrorText error={error} />
        <Button variant="outline" className="w-full" onClick={onDone}>
          Done
        </Button>
      </div>
    </Card>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="muted">{k}</dt>
      <dd className="tabular-nums">{v}</dd>
    </div>
  );
}
