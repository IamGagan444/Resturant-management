"use client";

import { useQuery } from "@tanstack/react-query";
import type { HotelStatus, PlatformOverview } from "@rms/contracts";
import { AlertTriangle, ArrowRight, Building2, CalendarClock, CloudOff, KeySquare, Rocket, ShoppingBag, TrendingUp, Utensils } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Card, CardHeader, LinkButton, Stat } from "@/components/ui";
import { Loadable } from "@/components/ui/feedback";
import { CardSkeleton, StatsSkeleton } from "@/components/ui/skeleton";
import { PageTitle, STATUS_LABEL, STATUS_TONE, shortDate, timeAgo } from "@/components/platform/common";

const STATUS_BAR: Record<HotelStatus, string> = { TRIAL: "bg-brand", ACTIVE: "bg-fresh", SUSPENDED: "bg-warn", CANCELLED: "bg-late" };

/** Super admin dashboard: platform health at a glance, plus what needs attention. */
export default function PlatformDashboard() {
  const overview = useQuery({ queryKey: ["p", "overview"], queryFn: () => api<PlatformOverview>("GET", "/v1/platform/overview"), refetchInterval: 60_000 });

  return (
    <>
      <PageTitle
        title="Dashboard"
        hint="Restaurants, orders and anything that needs your attention."
        action={
          <LinkButton href="/platform/onboard/" variant="primary">
            <Rocket className="h-4 w-4" aria-hidden />
            Onboard a restaurant
          </LinkButton>
        }
      />
      <Loadable
        query={overview}
        skeleton={
          <div className="space-y-6">
            <StatsSkeleton count={4} />
            <div className="grid gap-6 xl:grid-cols-2">
              <CardSkeleton lines={4} />
              <CardSkeleton lines={4} />
            </div>
          </div>
        }
      >
        {(o) => {
          const problems = o.problems.failedPaymentsLast24h + o.problems.failedSyncsLast24h;
          return (
            <div className="space-y-6">
              <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Restaurants" value={o.hotels.total} hint={`${o.hotels.newLast30d} new in 30 days`} icon={Building2} />
                <Stat label="Orders (24h)" value={o.activity.ordersLast24h} hint={`${o.activity.ordersLast7d} in 7 days`} icon={ShoppingBag} />
                <Stat label="Live tables" value={o.activity.liveSessions} hint="Guests seated right now" icon={Utensils} />
                <Stat label="Signed-in people" value={o.activity.staffSignedIn} hint="Owners and staff with a live sign-in" icon={KeySquare} />
              </div>

              {problems > 0 && (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl border border-late/40 bg-late/8 p-4">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-late" aria-hidden />
                  <p className="flex-1 text-sm font-medium">
                    In the last 24 hours: {o.problems.failedPaymentsLast24h} failed payment{o.problems.failedPaymentsLast24h === 1 ? "" : "s"},{" "}
                    {o.problems.failedSyncsLast24h} offline action{o.problems.failedSyncsLast24h === 1 ? "" : "s"} refused.
                  </p>
                  <CloudOff className="muted h-4 w-4" aria-hidden />
                </div>
              )}

              <div className="stagger grid gap-6 xl:grid-cols-2">
                <Card>
                  <CardHeader title="Restaurants by status" />
                  <div className="flex h-3 overflow-hidden rounded-full bg-(--sunken)">
                    {(Object.keys(o.hotels.byStatus) as HotelStatus[]).map((s) =>
                      o.hotels.byStatus[s] ? (
                        <span key={s} className={`grow-x ${STATUS_BAR[s]}`} style={{ width: `${(o.hotels.byStatus[s] / Math.max(1, o.hotels.total)) * 100}%` }} />
                      ) : null,
                    )}
                  </div>
                  <ul className="mt-4 grid grid-cols-2 gap-3">
                    {(Object.keys(o.hotels.byStatus) as HotelStatus[]).map((s) => (
                      <li key={s} className="flex items-center gap-2 text-sm">
                        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_BAR[s]}`} aria-hidden />
                        <span className="muted flex-1">{STATUS_LABEL[s]}</span>
                        <span className="font-bold tabular-nums">{o.hotels.byStatus[s]}</span>
                      </li>
                    ))}
                  </ul>
                </Card>

                <Card>
                  <CardHeader title="Trials ending soon" hint="Within the next 7 days" />
                  {o.trialsEndingSoon.length === 0 ? (
                    <p className="muted text-sm">No trials ending this week.</p>
                  ) : (
                    <ul className="space-y-2">
                      {o.trialsEndingSoon.map((t) => {
                        const overdue = new Date(t.trialEndsAt).getTime() < Date.now();
                        return (
                          <li key={t.id} className="line flex items-center gap-3 rounded-xl border p-3">
                            <CalendarClock className={`h-4 w-4 shrink-0 ${overdue ? "text-late" : "text-warn"}`} aria-hidden />
                            <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                            <Badge tone={overdue ? "late" : "warn"}>{overdue ? "ended" : "ends"} {shortDate(t.trialEndsAt)}</Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>

                <Card>
                  <CardHeader title="Busiest this week" hint="Orders in the last 7 days" />
                  {o.topHotels.length === 0 ? (
                    <p className="muted text-sm">No orders yet this week.</p>
                  ) : (
                    <ol className="space-y-3">
                      {o.topHotels.map((h, i) => (
                        <li key={h.id} className="flex items-center gap-3 text-sm">
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-(--sunken) text-xs font-bold">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{h.name}</span>
                            <span className="mt-1 block h-1.5 rounded-full bg-(--sunken)">
                              <span className="grow-x block h-full rounded-full bg-brand" style={{ width: `${(h.orders / Math.max(1, o.topHotels[0]!.orders)) * 100}%` }} />
                            </span>
                          </span>
                          <span className="flex items-center gap-1 font-bold tabular-nums">
                            <TrendingUp className="h-3.5 w-3.5 text-fresh" aria-hidden />
                            {h.orders}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </Card>

                <Card>
                  <CardHeader
                    title="Recently onboarded"
                    action={
                      <a href="/platform/restaurants/" className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
                        All restaurants <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    }
                  />
                  {o.recentHotels.length === 0 ? (
                    <p className="muted text-sm">No restaurants yet. Onboard the first one.</p>
                  ) : (
                    <ul className="divide-y divide-(--line)">
                      {o.recentHotels.map((h) => (
                        <li key={h.id} className="flex items-center gap-3 py-2.5">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-xs font-bold text-brand">{h.name.slice(0, 2).toUpperCase()}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{h.name}</span>
                            <span className="muted text-xs">{timeAgo(h.createdAt)}</span>
                          </span>
                          <Badge tone={STATUS_TONE[h.status]}>{STATUS_LABEL[h.status]}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          );
        }}
      </Loadable>
    </>
  );
}
