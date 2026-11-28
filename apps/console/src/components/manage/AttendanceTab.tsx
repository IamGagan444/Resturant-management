"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AttendanceDay, AttendanceMarkKind, AttendanceRow, AttendanceStatus } from "@rms/contracts";
import { AlertTriangle, CalendarCheck, ChevronLeft, ChevronRight, Clock, UserCheck, UserX, Users } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, CardHeader, EmptyState, Stat } from "@/components/ui";
import { DropdownMenuItem, DropdownMenuSeparator, RowActions } from "@/components/ui/dropdown-menu";
import { Loadable, notify } from "@/components/ui/feedback";
import { ListSkeleton } from "@/components/ui/skeleton";

const STATUS: Record<AttendanceStatus, { label: string; tone: "fresh" | "brand" | "warn" | "late" | "neutral" }> = {
  ON_DUTY: { label: "On duty now", tone: "fresh" },
  PRESENT: { label: "Came in", tone: "brand" },
  NOT_IN: { label: "Not in yet", tone: "neutral" },
  ABSENT: { label: "Absent", tone: "late" },
  LEAVE: { label: "On leave", tone: "warn" },
  WEEK_OFF: { label: "Week off", tone: "neutral" },
};
const MARKS: { kind: AttendanceMarkKind; label: string }[] = [
  { kind: "PRESENT", label: "Mark present" },
  { kind: "LEAVE", label: "Mark on leave" },
  { kind: "WEEK_OFF", label: "Mark week off" },
  { kind: "ABSENT", label: "Mark absent" },
];
const ROLE: Record<string, string> = { WAITER: "Waiter", COOK: "Cook", CASHIER: "Cashier", MANAGER: "Manager" };

const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};
const hm = (min: number) => (min < 1 ? "<1 min" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`);

export function AttendanceTab() {
  const qc = useQueryClient();
  const [day, setDay] = useState<string | null>(null); // null = today (the server decides, in the restaurant's timezone)
  const q = useQuery({
    queryKey: ["admin", "attendance", day],
    queryFn: () => api<AttendanceDay>("GET", `/v1/admin/attendance${day ? `?day=${day}` : ""}`),
    // today changes as people arrive and leave; past days don't
    refetchInterval: (query) => (query.state.data?.isToday ? 60_000 : false),
  });
  const shown = q.data?.day;

  async function mark(r: AttendanceRow, kind: AttendanceMarkKind | null) {
    if (!shown) return;
    try {
      await api("PUT", `/v1/admin/attendance/${r.staff.id}/${shown}`, { kind });
      notify.ok(kind ? `${r.staff.name}: ${MARKS.find((m) => m.kind === kind)!.label.replace("Mark ", "")}` : `${r.staff.name}: mark cleared`);
      void qc.invalidateQueries({ queryKey: ["admin", "attendance"] });
    } catch (e) {
      notify.error(e);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={q.data ? (q.data.isToday ? "Today" : new Date(`${q.data.day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })) : "Attendance"}
          hint="Filled in automatically: anyone signed in on a staff screen counts as here. Correct it with leave, week off or a manual mark."
          action={
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" className="h-10 w-10 px-0" aria-label="Previous day" disabled={!shown} onClick={() => shown && setDay(shiftDay(shown, -1))}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <input
                type="date"
                aria-label="Pick a day"
                className="h-10 w-40"
                value={shown ?? ""}
                onChange={(e) => e.target.value && setDay(e.target.value)}
              />
              <Button type="button" variant="outline" className="h-10 w-10 px-0" aria-label="Next day" disabled={!shown || q.data?.isToday} onClick={() => shown && setDay(shiftDay(shown, 1))}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
              {day && !q.data?.isToday && (
                <Button type="button" variant="ghost" className="h-10 px-3" onClick={() => setDay(null)}>
                  Today
                </Button>
              )}
            </div>
          }
        />
        <Loadable query={q} skeleton={<ListSkeleton rows={5} cols={1} />}>
          {(d) => (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat label="Came in" value={`${d.counts.present}/${d.counts.total}`} icon={UserCheck} />
                <Stat label="On duty now" value={d.isToday ? d.counts.onDuty : "–"} icon={Clock} hint={d.isToday ? "Active in the last 10 min" : "Only for today"} />
                <Stat label={d.isToday ? "Not in yet" : "Didn't come"} value={d.isToday ? d.counts.notIn : d.counts.away} icon={UserX} bad={!d.isToday && d.counts.away > 0} />
                <Stat label="Leave & week off" value={d.rows.filter((r) => r.status === "LEAVE" || r.status === "WEEK_OFF").length} icon={CalendarCheck} />
              </div>
              {d.rows.length === 0 ? (
                <EmptyState icon={Users} title="No team members yet" hint="Add staff under Staff. They show up here once they sign in on a device." />
              ) : (
                <ul className="space-y-2">
                  {d.rows.map((r) => (
                    <Person key={r.staff.id} r={r} d={d} onMark={(k) => void mark(r, k)} />
                  ))}
                </ul>
              )}
            </>
          )}
        </Loadable>
      </Card>
    </div>
  );
}

function Person({ r, d, onMark }: { r: AttendanceRow; d: AttendanceDay; onMark: (k: AttendanceMarkKind | null) => void }) {
  const s = STATUS[r.status];
  const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: d.timezone });
  const from = Date.parse(d.from);
  const span = Date.parse(d.to) - from;
  return (
    <li className="line rounded-xl border p-3">
      <div className="flex items-center gap-3">
        <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand/10 font-bold text-brand">
          {r.staff.name.slice(0, 1).toUpperCase()}
          {r.status === "ON_DUTY" && <span className="absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-(--surface) bg-fresh" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold">{r.staff.name}</span>
            <Badge tone={s.tone}>{s.label}</Badge>
            {r.mark && <Badge>marked{r.mark.by ? ` by ${r.mark.by}` : ""}</Badge>}
          </p>
          <p className="muted mt-0.5 truncate text-xs">
            {ROLE[r.staff.role] ?? r.staff.role}
            {r.staff.station && ` · ${r.staff.station}`}
            {r.firstIn && r.lastSeen && ` · ${time(r.firstIn)} – ${r.status === "ON_DUTY" ? "now" : time(r.lastSeen)} · ${hm(r.workedMin)}`}
            {r.mark?.note && ` · “${r.mark.note}”`}
          </p>
        </div>
        <RowActions label={`Attendance for ${r.staff.name}`}>
          {MARKS.map((m) => (
            <DropdownMenuItem key={m.kind} disabled={r.mark?.kind === m.kind} onSelect={() => onMark(m.kind)}>
              {m.label}
            </DropdownMenuItem>
          ))}
          {r.mark && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onMark(null)}>Clear mark (use device sign-ins)</DropdownMenuItem>
            </>
          )}
        </RowActions>
      </div>
      {r.conflict && (
        <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-warn/12 px-2.5 py-1.5 text-xs font-medium text-warn">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Marked {s.label.toLowerCase()}, but signed in on a device this day ({hm(r.workedMin)}). Check and clear the mark if wrong.
        </p>
      )}
      {r.spans.length > 0 && (
        // the business day as a bar; each block is time present
        <div className="relative mt-2.5 h-1.5 overflow-hidden rounded-full bg-(--sunken)" role="img" aria-label={`Present ${r.spans.map((x) => `${time(x.start)} to ${time(x.end)}`).join(", ")}`}>
          {r.spans.map((x) => {
            const left = ((Date.parse(x.start) - from) / span) * 100;
            const width = Math.max(0.6, ((Date.parse(x.end) - Date.parse(x.start)) / span) * 100);
            return <span key={x.start} className="absolute inset-y-0 rounded-full bg-fresh" style={{ left: `${left}%`, width: `${width}%` }} />;
          })}
        </div>
      )}
    </li>
  );
}
