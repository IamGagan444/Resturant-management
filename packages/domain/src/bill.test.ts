import { describe, expect, it } from "vitest";
import { computeBill, splitEqual, splitProportional, type BillLineInput } from "./bill";

const GST5 = [
  { name: "CGST", rateBps: 250 },
  { name: "SGST", rateBps: 250 },
];
const lines: BillLineInput[] = [
  { amount: 12000, taxes: GST5 }, // 2 × naan @ ₹60
  { amount: 2000, taxes: [] }, // packaged water, untaxed here
];
const exclusive = { pricesIncludeTax: false, discount: 0, serviceChargeBps: 0 };

describe("computeBill", () => {
  it("computes simple exclusive GST", () => {
    expect(computeBill(lines, exclusive)).toEqual({
      subtotal: 14000,
      discount: 0,
      serviceCharge: 0,
      taxLines: [
        { name: "CGST", rateBps: 250, taxable: 12000, amount: 300 },
        { name: "SGST", rateBps: 250, taxable: 12000, amount: 300 },
      ],
      taxTotal: 600,
      roundOff: 0,
      total: 14600,
    });
  });

  it("taxes service charge at the bucket rate and rounds to the rupee", () => {
    const b = computeBill(lines, { ...exclusive, serviceChargeBps: 1000 });
    expect(b.serviceCharge).toBe(1400);
    expect(b.taxLines).toEqual([
      { name: "CGST", rateBps: 250, taxable: 13200, amount: 330 },
      { name: "SGST", rateBps: 250, taxable: 13200, amount: 330 },
    ]);
    // 14000 + 1400 + 660 = 16060 → ₹161
    expect(b.roundOff).toBe(40);
    expect(b.total).toBe(16100);
  });

  it("applies discount before tax, pro-rata across buckets", () => {
    const b = computeBill(lines, { ...exclusive, discount: 1400 });
    expect(b.taxLines.map((t) => [t.taxable, t.amount])).toEqual([
      [10800, 270],
      [10800, 270],
    ]);
    // 12600 + 540 = 13140 → ₹131
    expect(b.roundOff).toBe(-40);
    expect(b.total).toBe(13100);
  });

  it("clamps discount to subtotal", () => {
    expect(computeBill(lines, { ...exclusive, discount: 999_999 }).total).toBe(0);
  });

  it("backs tax out of inclusive prices so the customer pays the menu price", () => {
    const b = computeBill([{ amount: 10500, taxes: GST5 }], { ...exclusive, pricesIncludeTax: true });
    expect(b.taxLines).toEqual([
      { name: "CGST", rateBps: 250, taxable: 10000, amount: 250 },
      { name: "SGST", rateBps: 250, taxable: 10000, amount: 250 },
    ]);
    expect(b.total).toBe(10500);
    expect(b.roundOff).toBe(0);
  });

  it("aggregates the same tax across different tax sets", () => {
    const b = computeBill(
      [
        { amount: 10000, taxes: GST5 },
        {
          amount: 10000,
          taxes: [
            { name: "CGST", rateBps: 900 },
            { name: "SGST", rateBps: 900 },
          ],
        },
      ],
      exclusive,
    );
    expect(b.taxLines.map((t) => `${t.name}@${t.rateBps}=${t.amount}`)).toEqual([
      "CGST@250=250",
      "CGST@900=900",
      "SGST@250=250",
      "SGST@900=900",
    ]);
    expect(b.total).toBe(22300);
  });
});

describe("splits", () => {
  it("equal split sums exactly", () => {
    expect(splitEqual(10000, 3)).toEqual([3334, 3333, 3333]);
  });
  it("proportional split sums exactly", () => {
    const parts = splitProportional(16100, [6000, 6000, 2000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(16100);
    expect(parts[0]).toBe(parts[1]);
  });
});
