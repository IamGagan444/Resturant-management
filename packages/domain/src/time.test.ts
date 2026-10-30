import { describe, expect, it } from "vitest";
import { businessDate, businessDayRange, fiscalYearLabel, formatBillNumber, isWithinWindow } from "./time";

const IST = "Asia/Kolkata";

describe("businessDate", () => {
  it("keeps late-night orders on the previous business day", () => {
    // 01:30 IST on Oct 31
    expect(businessDate(new Date("2026-10-30T20:00:00Z"), IST, "04:00")).toBe("2026-10-30");
  });
  it("rolls over after dayStartsAt", () => {
    // 04:30 IST on Oct 31
    expect(businessDate(new Date("2026-10-30T23:00:00Z"), IST, "04:00")).toBe("2026-10-31");
  });
  it("handles month/year boundaries", () => {
    // 00:30 IST Jan 1 2027
    expect(businessDate(new Date("2026-12-31T19:00:00Z"), IST, "04:00")).toBe("2026-12-31");
  });
});

describe("fiscalYearLabel", () => {
  it("uses the April–March Indian FY in local time", () => {
    expect(fiscalYearLabel(new Date("2026-10-30T10:00:00Z"), IST)).toBe("2627");
    expect(fiscalYearLabel(new Date("2027-02-15T10:00:00Z"), IST)).toBe("2627");
    expect(fiscalYearLabel(new Date("2026-03-31T12:00:00Z"), IST)).toBe("2526");
    // 00:30 IST Apr 1 2026 is still Mar 31 in UTC
    expect(fiscalYearLabel(new Date("2026-03-31T19:00:00Z"), IST)).toBe("2627");
  });
});

describe("formatBillNumber", () => {
  it("formats within GST limits", () => {
    expect(formatBillNumber("INV", "2627", 42)).toBe("INV/2627/00042");
  });
  it("rejects numbers over 16 chars or with bad characters", () => {
    expect(() => formatBillNumber("ABCDEFG", "2627", 1)).toThrow();
    expect(() => formatBillNumber("IN V", "2627", 1)).toThrow();
  });
});

describe("isWithinWindow", () => {
  it("handles normal windows", () => {
    // 09:00 IST
    expect(isWithinWindow(new Date("2026-10-30T03:30:00Z"), IST, "07:00", "11:00")).toBe(true);
    // 11:30 IST
    expect(isWithinWindow(new Date("2026-10-30T06:00:00Z"), IST, "07:00", "11:00")).toBe(false);
  });
  it("handles overnight windows", () => {
    // 23:00 IST
    expect(isWithinWindow(new Date("2026-10-30T17:30:00Z"), IST, "22:00", "02:00")).toBe(true);
    // 03:00 IST
    expect(isWithinWindow(new Date("2026-10-30T21:30:00Z"), IST, "22:00", "02:00")).toBe(false);
  });
  it("treats missing bounds as always open", () => {
    expect(isWithinWindow(new Date(), IST, null, null)).toBe(true);
  });
});

describe("businessDayRange", () => {
  it("spans dayStartsAt to dayStartsAt next day, in local time", () => {
    const r = businessDayRange("2026-10-30", "Asia/Kolkata", "04:00");
    expect(r.from.toISOString()).toBe("2026-10-29T22:30:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-30T22:30:00.000Z");
  });

  it("is consistent with businessDate at both edges", () => {
    const r = businessDayRange("2027-03-31", "Asia/Kolkata", "04:00");
    expect(businessDate(r.from, "Asia/Kolkata", "04:00")).toBe("2027-03-31");
    expect(businessDate(new Date(r.to.getTime() - 1), "Asia/Kolkata", "04:00")).toBe("2027-03-31");
    expect(businessDate(r.to, "Asia/Kolkata", "04:00")).toBe("2027-04-01");
  });

  it("handles DST zones (23h day)", () => {
    const r = businessDayRange("2026-03-08", "America/New_York", "00:00");
    expect(r.to.getTime() - r.from.getTime()).toBe(23 * 3600_000);
  });

  it("rejects malformed keys", () => {
    expect(() => businessDayRange("30-10-2026", "Asia/Kolkata", "04:00")).toThrow();
  });
});
