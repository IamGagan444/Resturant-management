"use client";

import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AuditAction, type AuditEntry, type AuditPage, type SyncRejectionView } from "@rms/contracts";
import { api, rupees } from "@/lib/api";
import { ClipboardList } from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorText } from "@/components/ui";

const LABEL: Record<AuditAction, string> = {
  ORDER_CANCELLED: "Order cancelled",
  ORDER_REJECTED: "Order rejected",
  ITEM_CANCELLED: "Item cancelled",
  ITEM_OUT_OF_STOCK: "Item ran out",
  MENU_AVAILABILITY: "Stock changed",
  DISCOUNT_APPLIED: "Discount",
  SERVICE_CHARGE_REMOVED: "Service charge removed",
  PRICE_CHANGED: "Price changed",
  BILL_VOIDED: "Bill voided",
  QR_ROTATED: "QR code replaced",
  STAFF_PIN_RESET: "PIN reset",
  BILL_SPLIT: "Bill split",
  BILL_SENT: "Bill sent",
  ITEM_REPLACED: "Item swapped",
  HUB_PAIRED: "Local hub set up",
  HUB_REMOVED: "Local hub removed",
};

const label = (a: string) => (a in LABEL ? LABEL[a as AuditAction] : a);

/** One readable line from the action's details (amounts in ₹, reasons quoted). */
function describe(e: AuditEntry): string {
  const m = e.meta && typeof e.meta === "object" ? (e.meta as Record<string, unknown>) : {};
  const parts: string[] = [];
  if (typeof m.from === "number" && typeof m.to === "number") parts.push(`${rupees(m.from)} → ${rupees(m.to)}`);
  if (typeof m.isAvailable === "boolean") parts.push(m.isAvailable ? "back in stock" : "out of stock");
  if (typeof m.type === "string") parts.push(m.type.replace("_", " ").toLowerCase());
  if (typeof m.reason === "string" && m.reason) parts.push(`“${m.reason}”`);
  if (typeof m.phone === "string") parts.push(m.phone);
  if (typeof m.url === "string") parts.push(m.url);
  return parts.join(" · ");
}

/** Who did what, when: voids, cancellations, discounts, price and stock changes. Plus offline actions the server refused. */
export function AuditTab() {
  const [action, setAction] = useState<AuditAction | "">("");
  const log = useInfiniteQuery({
    queryKey: ["admin", "audit", action],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "50", ...(action ? { action } : {}), ...(pageParam ? { before: pageParam } : {}) });
      return api<AuditPage>("GET", `/v1/admin/audit?${qs}`);
    },
    getNextPageParam: (last) => last.next,
  });
  const rejected = useQuery({ queryKey: ["admin", "sync-rejections"], queryFn: () => api<SyncRejectionView[]>("GET", "/v1/admin/sync-rejections") });
  const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Audit log"
          hint="Voids, cancellations, discounts, price and stock changes: who did what, and when."
          action={
            <select aria-label="Filter by action" value={action} onChange={(e) => setAction(e.target.value as AuditAction | "")}>
              <option value="">All actions</option>
              {AuditAction.options.map((a) => (
                <option key={a} value={a}>
                  {LABEL[a]}
                </option>
              ))}
            </select>
          }
        />
        <ErrorText error={log.error} />
        {entries.length === 0 && !log.isLoading && <EmptyState icon={ClipboardList} title="Nothing recorded yet" />}
        <ul className={`line divide-y divide-(--line) rounded-xl border ${entries.length ? "" : "hidden"}`}>
          {entries.map((e) => (
            <li key={e.id} className="grid items-center gap-1 px-3 py-2.5 text-sm sm:grid-cols-[8.5rem_11rem_1fr] sm:gap-3">
              <time className="muted text-xs tabular-nums sm:text-sm" dateTime={e.createdAt}>
                {new Date(e.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </time>
              <span>
                <Badge tone="brand">{label(e.action)}</Badge>
              </span>
              <span>
                {e.actor ? `${e.actor.name} (${e.actor.role.toLowerCase()})` : "System"}
                {describe(e) && <span className="muted"> · {describe(e)}</span>}
              </span>
            </li>
          ))}
        </ul>
        {log.hasNextPage && (
          <Button variant="outline" className="mt-3 w-full" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
            Load older
          </Button>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Offline actions that didn't go through"
          hint="Taps made without internet that the server refused when they synced, e.g. a dish someone else had already served."
        />
        {rejected.data?.length === 0 && <p className="muted text-sm">None. Everything synced.</p>}
        <ul className="space-y-2 text-sm">
          {rejected.data?.map((r) => {
            const cmd = r.command && typeof r.command === "object" ? (r.command as { command?: { type?: string } }).command : undefined;
            return (
              <li key={r.id} className="line flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2">
                <time className="muted tabular-nums">{new Date(r.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
                <span className="rounded-md bg-(--sunken) px-1.5 py-0.5 font-mono text-xs">{cmd?.type ?? "?"}</span>
                <span>{r.reason}</span>
                {r.device && <span className="muted">· {r.device}</span>}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
