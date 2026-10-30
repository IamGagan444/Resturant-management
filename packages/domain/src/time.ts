/** Wall-clock parts of `date` in IANA timezone `tz`. */
export function zonedParts(date: Date, tz: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Business date for daily order numbers. Before `dayStartsAt` (e.g. "04:00") local time,
 * orders still belong to the previous day — restaurants close after midnight.
 * Returns "YYYY-MM-DD".
 */
export function businessDate(now: Date, tz: string, dayStartsAt: string): string {
  const p = zonedParts(now, tz);
  if (p.hour * 60 + p.minute >= toMinutes(dayStartsAt)) return ymd(p.year, p.month, p.day);
  const prev = new Date(Date.UTC(p.year, p.month - 1, p.day) - 86_400_000);
  return ymd(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
}

/** Indian financial year (Apr–Mar) label: Oct 2026 → "2627", Feb 2027 → "2627". */
export function fiscalYearLabel(now: Date, tz: string): string {
  const { year, month } = zonedParts(now, tz);
  const start = month >= 4 ? year : year - 1;
  return `${String(start % 100).padStart(2, "0")}${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * GST invoice number: max 16 chars, only letters, digits, '/' and '-', unique per financial year.
 * "INV" + FY "2627" + seq 42 → "INV/2627/00042"
 */
export function formatBillNumber(prefix: string, fy: string, seq: number): string {
  const s = `${prefix}/${fy}/${String(seq).padStart(5, "0")}`;
  if (s.length > 16) throw new Error(`Bill number "${s}" exceeds 16 characters`);
  if (!/^[A-Za-z0-9/-]+$/.test(s)) throw new Error(`Bill number "${s}" has invalid characters`);
  return s;
}

/** Is local time inside [from, to)? Handles overnight windows like 22:00–02:00. Null bounds = always. */
export function isWithinWindow(now: Date, tz: string, from: string | null, to: string | null): boolean {
  if (!from || !to) return true;
  const p = zonedParts(now, tz);
  const t = p.hour * 60 + p.minute;
  const f = toMinutes(from);
  const e = toMinutes(to);
  return f <= e ? t >= f && t < e : t >= f || t < e;
}

/** UTC instant of local wall time y-m-d h:min in `tz` (two passes so DST edges settle). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(guess);
}

/**
 * The [from, to) instants of business date `key` ("YYYY-MM-DD"): from dayStartsAt that day
 * until dayStartsAt the next day. Used by end-of-day reports.
 */
export function businessDayRange(key: string, tz: string, dayStartsAt: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) throw new Error(`Invalid business date "${key}"`);
  const start = toMinutes(dayStartsAt);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const next = new Date(Date.UTC(y, mo - 1, d) + 86_400_000);
  return {
    from: zonedToUtc(y, mo, d, Math.floor(start / 60), start % 60, tz),
    to: zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), Math.floor(start / 60), start % 60, tz),
  };
}
