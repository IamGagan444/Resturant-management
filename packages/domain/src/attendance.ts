/**
 * Staff attendance from presence.
 *
 * Signals: every signed-in staff screen talks to the server every 15–30 s while it is open (polls, taps), and a PIN
 * sign-in is an explicit "I'm here". The server turns those pings into presence spans with *gap-based
 * sessionization*, the same technique web analytics uses for visits:
 *
 *   - a ping within GAP of the person's last ping extends their current span (lastSeenAt = now);
 *   - a longer silence (phone locked in a pocket, Wi-Fi down, went home) closes the span at its last ping, and the
 *     next ping opens a new one;
 *   - signing out ends the span immediately (endedAt).
 *
 * That is O(1) work and at most one row update per ping, and a whole day is a handful of rows per person.
 * Reading a day then:
 *   1. clips every span to the business day [from, to) (a shift that crosses the day boundary counts on both days,
 *      each for its own part);
 *   2. sorts and merges overlapping spans (two devices at once, a retried write, an out-of-order ping), so time is
 *      never counted twice: O(n log n);
 *   3. derives the status, and lets a manager's mark (leave, week off, absent, present) override it, flagging the
 *      case where the mark contradicts what the devices saw.
 *
 * Everything here is pure (numbers in, numbers out) and unit tested; the API only stores and loads spans.
 */

export const PRESENCE = {
  /** Silence longer than this splits a span. Bridges a locked phone between table rounds; a lunch break splits. */
  GAP_MS: 45 * 60_000,
  /** Seen this recently (and not signed out) = working right now. Screens ping every ≤ 30 s while open. */
  ACTIVE_MS: 10 * 60_000,
  /** Write at most one ping per person per minute: worst-case error is one minute on a multi-hour shift. */
  MIN_WRITE_MS: 60_000,
} as const;

export interface PresenceSpan {
  /** epoch ms */
  start: number;
  /** epoch ms of the last ping (or the sign-out) */
  end: number;
  /** signed out explicitly (not just silent) */
  ended?: boolean;
}

/** What to do with a new ping, given the person's latest span. */
export function presenceStep(last: { lastSeenAt: number; endedAt: number | null } | null, now: number, gapMs: number = PRESENCE.GAP_MS): "extend" | "open" {
  if (!last || last.endedAt !== null) return "open";
  // a ping older than the span's last one (clock skew between API servers, a retried request) still belongs to it
  return now - last.lastSeenAt > gapMs ? "open" : "extend";
}

/** Drops malformed spans and repairs reversed ones (end before start) to zero length. */
function normalise(spans: readonly PresenceSpan[]): PresenceSpan[] {
  const out: PresenceSpan[] = [];
  for (const s of spans) {
    if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) continue;
    out.push({ start: s.start, end: Math.max(s.start, s.end), ended: s.ended ?? false });
  }
  return out;
}

/**
 * Classic interval merge: sort by start, then fold each span into the previous one when they overlap or touch
 * (or are within `joinGapMs`). The merged span is "ended" only if the span that reaches furthest was ended.
 */
export function mergeSpans(spans: readonly PresenceSpan[], joinGapMs = 0): PresenceSpan[] {
  const sorted = normalise(spans).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: PresenceSpan[] = [];
  for (const s of sorted) {
    const prev = merged[merged.length - 1];
    if (prev && s.start <= prev.end + joinGapMs) {
      if (s.end > prev.end) {
        prev.end = s.end;
        prev.ended = s.ended;
      } else if (s.end === prev.end) {
        prev.ended = Boolean(prev.ended) && Boolean(s.ended); // still open if either copy is open
      }
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

/** Keeps only the part of each span inside [from, to). Spans wholly outside are dropped. */
export function clipSpans(spans: readonly PresenceSpan[], from: number, to: number): PresenceSpan[] {
  const out: PresenceSpan[] = [];
  for (const s of normalise(spans)) {
    if (s.end < from || s.start >= to) continue;
    const start = Math.max(s.start, from);
    const end = Math.min(s.end, to);
    // a span running past the day's end isn't "signed out" inside this day
    out.push({ start, end, ended: s.end <= to ? s.ended : false });
  }
  return out;
}

export const totalMs = (spans: readonly PresenceSpan[]) => spans.reduce((sum, s) => sum + (s.end - s.start), 0);

export const ATTENDANCE_MARKS = ["PRESENT", "ABSENT", "LEAVE", "WEEK_OFF"] as const;
export type AttendanceMark = (typeof ATTENDANCE_MARKS)[number];

/**
 * ON_DUTY   working now (seen in the last ACTIVE_MS and not signed out)
 * PRESENT   came in this day (devices saw them, or a manager marked them present)
 * NOT_IN    today, nothing yet (the day isn't over, so not "absent")
 * ABSENT    a past day with no presence, or marked absent
 * LEAVE / WEEK_OFF   marked by a manager
 */
export type AttendanceStatus = "ON_DUTY" | "PRESENT" | "NOT_IN" | "ABSENT" | "LEAVE" | "WEEK_OFF";

export interface DayAttendance {
  status: AttendanceStatus;
  /** what the devices alone say, before any manager mark */
  observed: "ON_DUTY" | "PRESENT" | "NONE";
  /** a mark says away (absent / leave / week off) but devices saw them working, or vice versa is fine (manual present) */
  conflict: boolean;
  firstIn: number | null;
  lastSeen: number | null;
  /** merged, non-overlapping minutes of presence inside the day */
  workedMs: number;
  /** merged spans inside the day, for a timeline */
  spans: PresenceSpan[];
}

export function summarizeDay(input: {
  spans: readonly PresenceSpan[];
  /** business day [from, to) in epoch ms */
  from: number;
  to: number;
  now: number;
  mark?: AttendanceMark | null;
  activeMs?: number;
}): DayAttendance {
  const { from, to, now, mark = null, activeMs = PRESENCE.ACTIVE_MS } = input;
  // a ping can't be in the future: cap at now (clock skew), then clip to the day and merge
  const capped = normalise(input.spans).map((s) => ({ ...s, start: Math.min(s.start, now), end: Math.min(s.end, now) }));
  const spans = mergeSpans(clipSpans(capped, from, to));
  const last = spans[spans.length - 1];
  const dayIsLive = from <= now && now < to;
  const onDutyNow = Boolean(dayIsLive && last && !last.ended && now - last.end <= activeMs);
  const observed: DayAttendance["observed"] = onDutyNow ? "ON_DUTY" : spans.length ? "PRESENT" : "NONE";

  let status: AttendanceStatus;
  if (mark === "LEAVE" || mark === "WEEK_OFF" || mark === "ABSENT") status = mark;
  else if (observed !== "NONE") status = observed;
  else if (mark === "PRESENT") status = "PRESENT";
  else status = now < to ? "NOT_IN" : "ABSENT";

  return {
    status,
    observed,
    conflict: (mark === "LEAVE" || mark === "WEEK_OFF" || mark === "ABSENT") && observed !== "NONE",
    firstIn: spans[0]?.start ?? null,
    lastSeen: last?.end ?? null,
    workedMs: totalMs(spans),
    spans,
  };
}

/** Counts for the summary strip. NOT_IN counts as not present, ON_DUTY as present. */
export function attendanceCounts(statuses: readonly AttendanceStatus[]) {
  const c = { present: 0, onDuty: 0, away: 0, notIn: 0 };
  for (const s of statuses) {
    if (s === "ON_DUTY") {
      c.present++;
      c.onDuty++;
    } else if (s === "PRESENT") c.present++;
    else if (s === "NOT_IN") c.notIn++;
    else c.away++;
  }
  return c;
}
