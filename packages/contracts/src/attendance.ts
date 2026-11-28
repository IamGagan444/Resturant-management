import { z } from "zod";
import { AttendanceMarkKind, StaffRole } from "./enums";

export const BusinessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

/** Manager's mark for one person and day; `kind: null` clears it (back to what the devices saw). */
export const AttendanceMarkInput = z.object({
  kind: AttendanceMarkKind.nullable(),
  note: z.string().trim().max(200).nullish(),
});
export type AttendanceMarkInput = z.infer<typeof AttendanceMarkInput>;

export const AttendanceStatus = z.enum(["ON_DUTY", "PRESENT", "NOT_IN", "ABSENT", "LEAVE", "WEEK_OFF"]);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

export interface AttendanceRow {
  staff: { id: string; name: string; role: StaffRole; station: string | null };
  status: AttendanceStatus;
  /** what devices alone saw (before a manager's mark) */
  observed: "ON_DUTY" | "PRESENT" | "NONE";
  /** marked away but devices saw them working */
  conflict: boolean;
  mark: { kind: AttendanceMarkKind; note: string | null; by: string | null } | null;
  firstIn: string | null;
  lastSeen: string | null;
  workedMin: number;
  /** merged presence inside the day, ISO times */
  spans: { start: string; end: string }[];
}

export interface AttendanceDay {
  day: string;
  /** the business day's [from, to) */
  from: string;
  to: string;
  isToday: boolean;
  /** the restaurant's IANA timezone, for showing times */
  timezone: string;
  counts: { present: number; onDuty: number; away: number; notIn: number; total: number };
  rows: AttendanceRow[];
}
