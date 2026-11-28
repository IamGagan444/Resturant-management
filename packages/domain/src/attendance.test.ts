import { describe, expect, it } from "vitest";
import { PRESENCE, attendanceCounts, clipSpans, mergeSpans, presenceStep, summarizeDay, type PresenceSpan } from "./attendance";
import { businessDayRange } from "./time";

const MIN = 60_000;
const H = 60 * MIN;
const IST = "Asia/Kolkata";
// business day 2026-11-28, 04:00 IST → 04:00 IST next day
const { from, to } = businessDayRange("2026-11-28", IST, "04:00");
const F = from.getTime();
const T = to.getTime();
const at = (hours: number) => F + hours * H; // hours after 04:00 IST

/**
 * Replays pings through presenceStep exactly the way the API stores them (extend the latest span or open a new
 * one), so these tests cover the write path and the read path together.
 */
function replay(pings: number[], signOutAt: number[] = [], gap: number = PRESENCE.GAP_MS): PresenceSpan[] {
  const events = [...pings.map((t) => ({ t, out: false })), ...signOutAt.map((t) => ({ t, out: true }))].sort((a, b) => a.t - b.t);
  const rows: { start: number; lastSeenAt: number; endedAt: number | null }[] = [];
  for (const e of events) {
    const last = rows[rows.length - 1] ?? null;
    if (e.out) {
      if (last && last.endedAt === null) last.endedAt = Math.max(e.t, last.lastSeenAt);
      continue;
    }
    if (presenceStep(last, e.t, gap) === "extend") last!.lastSeenAt = Math.max(last!.lastSeenAt, e.t);
    else rows.push({ start: e.t, lastSeenAt: e.t, endedAt: null });
  }
  return rows.map((r) => ({ start: r.start, end: r.endedAt ?? r.lastSeenAt, ended: r.endedAt !== null }));
}
const every = (start: number, end: number, step = 30_000) => Array.from({ length: Math.floor((end - start) / step) + 1 }, (_, i) => start + i * step);

describe("presenceStep (write path)", () => {
  it("opens a span for the first ping and after a sign-out", () => {
    expect(presenceStep(null, 1000)).toBe("open");
    expect(presenceStep({ lastSeenAt: 1000, endedAt: 1000 }, 2000)).toBe("open");
  });
  it("extends within the gap and opens after it", () => {
    expect(presenceStep({ lastSeenAt: 0, endedAt: null }, PRESENCE.GAP_MS)).toBe("extend");
    expect(presenceStep({ lastSeenAt: 0, endedAt: null }, PRESENCE.GAP_MS + 1)).toBe("open");
  });
  it("keeps an out-of-order (older) ping in the current span", () => {
    expect(presenceStep({ lastSeenAt: 10 * MIN, endedAt: null }, 5 * MIN)).toBe("extend");
  });
});

describe("mergeSpans", () => {
  it("merges overlapping and touching spans, keeps separate ones apart", () => {
    expect(
      mergeSpans([
        { start: 50, end: 60 },
        { start: 0, end: 10 },
        { start: 5, end: 20 },
        { start: 20, end: 30 },
      ]),
    ).toEqual([
      { start: 0, end: 30, ended: false },
      { start: 50, end: 60, ended: false },
    ]);
  });
  it("swallows a span inside another", () => {
    expect(mergeSpans([{ start: 0, end: 100 }, { start: 10, end: 20, ended: true }])).toEqual([{ start: 0, end: 100, ended: false }]);
  });
  it("takes 'ended' from the span that reaches furthest", () => {
    expect(mergeSpans([{ start: 0, end: 50 }, { start: 10, end: 80, ended: true }])).toEqual([{ start: 0, end: 80, ended: true }]);
    // same end, one copy still open → open
    expect(mergeSpans([{ start: 0, end: 50, ended: true }, { start: 10, end: 50 }])).toEqual([{ start: 0, end: 50, ended: false }]);
  });
  it("repairs reversed spans and drops garbage", () => {
    expect(mergeSpans([{ start: 10, end: 5 }, { start: NaN, end: 3 }])).toEqual([{ start: 10, end: 10, ended: false }]);
  });
  it("is order independent", () => {
    const spans = [
      { start: 30, end: 40 },
      { start: 0, end: 10 },
      { start: 8, end: 12 },
      { start: 39, end: 45 },
    ];
    const expected = mergeSpans(spans);
    for (let i = 0; i < 20; i++) expect(mergeSpans([...spans].sort(() => Math.random() - 0.5))).toEqual(expected);
  });
});

describe("clipSpans", () => {
  it("cuts a shift that crosses the business-day boundary", () => {
    const night: PresenceSpan = { start: at(-2), end: at(1) }; // 02:00 → 05:00
    expect(clipSpans([night], F, T)).toEqual([{ start: F, end: at(1), ended: false }]);
  });
  it("a span that ends after the day isn't 'signed out' inside the day", () => {
    expect(clipSpans([{ start: at(23), end: at(25), ended: true }], F, T)).toEqual([{ start: at(23), end: T, ended: false }]);
  });
  it("drops spans wholly outside", () => {
    expect(clipSpans([{ start: at(-5), end: at(-1) }, { start: at(24), end: at(26) }], F, T)).toEqual([]);
  });
});

describe("summarizeDay", () => {
  it("a full shift of polling = one span, exact hours, on duty while still pinging", () => {
    const pings = every(at(6), at(14)); // 10:00 → 18:00 IST, every 30 s
    const d = summarizeDay({ spans: replay(pings), from: F, to: T, now: at(14) + 2 * MIN });
    expect(d.status).toBe("ON_DUTY");
    expect(d.spans).toHaveLength(1);
    expect(d.workedMs).toBe(8 * H);
    expect(d.firstIn).toBe(at(6));
  });

  it("a locked phone for 30 min stays one span; a 2-hour break splits it", () => {
    const pings = [...every(at(6), at(8)), ...every(at(8) + 30 * MIN, at(10)), ...every(at(12), at(14))];
    const d = summarizeDay({ spans: replay(pings), from: F, to: T, now: at(20) });
    expect(d.spans).toHaveLength(2);
    expect(d.workedMs).toBe(4 * H + 2 * H);
    expect(d.status).toBe("PRESENT"); // left hours ago
  });

  it("signing out ends 'on duty' at once", () => {
    const spans = replay(every(at(6), at(8)), [at(8)]);
    expect(summarizeDay({ spans, from: F, to: T, now: at(8) + MIN }).status).toBe("PRESENT");
  });

  it("goes quiet → not on duty after ACTIVE_MS, still present for the day", () => {
    const spans = replay(every(at(6), at(8)));
    expect(summarizeDay({ spans, from: F, to: T, now: at(8) + PRESENCE.ACTIVE_MS }).status).toBe("ON_DUTY");
    expect(summarizeDay({ spans, from: F, to: T, now: at(8) + PRESENCE.ACTIVE_MS + 1 }).status).toBe("PRESENT");
  });

  it("two devices at once never double-count time", () => {
    const phone = replay(every(at(6), at(10)));
    const kds = replay(every(at(7), at(9)));
    const d = summarizeDay({ spans: [...phone, ...kds], from: F, to: T, now: at(20) });
    expect(d.workedMs).toBe(4 * H);
    expect(d.spans).toHaveLength(1);
  });

  it("a single sign-in with no further pings still counts as present", () => {
    const d = summarizeDay({ spans: replay([at(6)]), from: F, to: T, now: at(20) });
    expect(d.status).toBe("PRESENT");
    expect(d.workedMs).toBe(0);
  });

  it("nobody seen: NOT_IN while the day runs, ABSENT once it is over", () => {
    expect(summarizeDay({ spans: [], from: F, to: T, now: at(3) }).status).toBe("NOT_IN");
    expect(summarizeDay({ spans: [], from: F, to: T, now: T }).status).toBe("ABSENT");
  });

  it("a night shift counts on both business days, each for its own part", () => {
    const spans = replay(every(at(20), at(26))); // 00:00 → 06:00 IST next morning... from 20h after 04:00
    const today = summarizeDay({ spans, from: F, to: T, now: at(30) });
    const next = summarizeDay({ spans, from: T, to: T + 24 * H, now: at(30) });
    expect(today.workedMs).toBe(4 * H);
    expect(next.workedMs).toBe(2 * H);
    expect(today.workedMs + next.workedMs).toBe(6 * H);
  });

  it("caps pings from the future (clock skew) at now", () => {
    const d = summarizeDay({ spans: [{ start: at(6), end: at(9) }], from: F, to: T, now: at(7) });
    expect(d.lastSeen).toBe(at(7));
    expect(d.workedMs).toBe(H);
  });

  it("manager marks override, and a contradiction is flagged", () => {
    expect(summarizeDay({ spans: [], from: F, to: T, now: at(3), mark: "LEAVE" }).status).toBe("LEAVE");
    expect(summarizeDay({ spans: [], from: F, to: T, now: T, mark: "PRESENT" }).status).toBe("PRESENT");
    const worked = summarizeDay({ spans: replay(every(at(6), at(7))), from: F, to: T, now: at(20), mark: "WEEK_OFF" });
    expect(worked.status).toBe("WEEK_OFF");
    expect(worked.conflict).toBe(true);
    expect(worked.workedMs).toBe(H); // the time is still shown
    // marked present and seen: no conflict, observed status wins
    expect(summarizeDay({ spans: replay([at(6)]), from: F, to: T, now: at(6), mark: "PRESENT" })).toMatchObject({ status: "ON_DUTY", conflict: false });
  });

  it("randomised: worked time never exceeds the day or wall-clock union", () => {
    for (let run = 0; run < 200; run++) {
      const pings = Array.from({ length: 50 }, () => F - 6 * H + Math.random() * 36 * H).sort((a, b) => a - b);
      const spans = replay(pings);
      const d = summarizeDay({ spans, from: F, to: T, now: T + H });
      expect(d.workedMs).toBeGreaterThanOrEqual(0);
      expect(d.workedMs).toBeLessThanOrEqual(T - F);
      // merged spans are sorted and disjoint
      for (let i = 1; i < d.spans.length; i++) expect(d.spans[i]!.start).toBeGreaterThan(d.spans[i - 1]!.end);
      // and every ping inside the day lies within some span
      for (const p of pings.filter((p) => p >= F && p < T)) expect(d.spans.some((s) => s.start <= p && p <= s.end)).toBe(true);
    }
  });
});

describe("attendanceCounts", () => {
  it("counts on-duty as present and leave/off/absent as away", () => {
    expect(attendanceCounts(["ON_DUTY", "PRESENT", "NOT_IN", "LEAVE", "ABSENT", "WEEK_OFF"])).toEqual({ present: 2, onDuty: 1, away: 3, notIn: 1 });
  });
});
