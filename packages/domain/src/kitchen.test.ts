import { describe, expect, it } from "vitest";
import { ageLevel, aggregatePending, estimateEta } from "./kitchen";

describe("ageLevel", () => {
  const placed = new Date("2026-10-30T10:00:00Z");
  const at = (min: number) => new Date(placed.getTime() + min * 60_000);
  it("goes green → amber → red against prep time", () => {
    expect(ageLevel(placed, 20, at(10))).toBe("fresh");
    expect(ageLevel(placed, 20, at(16))).toBe("warning");
    expect(ageLevel(placed, 20, at(20))).toBe("late");
  });
});

describe("aggregatePending", () => {
  it("sums queued/cooking quantities by name + variant", () => {
    expect(
      aggregatePending([
        { name: "Butter Naan", variantName: null, quantity: 3, status: "QUEUED" },
        { name: "Butter Naan", variantName: null, quantity: 5, status: "COOKING" },
        { name: "Butter Naan", variantName: null, quantity: 4, status: "READY" },
        { name: "Paneer Tikka", variantName: "Half", quantity: 2, status: "QUEUED" },
        { name: "Paneer Tikka", variantName: "Full", quantity: 1, status: "QUEUED" },
      ]),
    ).toEqual([
      { name: "Butter Naan", variantName: null, quantity: 8 },
      { name: "Paneer Tikka", variantName: "Half", quantity: 2 },
      { name: "Paneer Tikka", variantName: "Full", quantity: 1 },
    ]);
  });
});

describe("estimateEta", () => {
  it("uses longest prep time plus capped load", () => {
    const placed = new Date("2026-10-30T10:00:00Z");
    expect(estimateEta(placed, [10, 20]).toISOString()).toBe("2026-10-30T10:20:00.000Z");
    expect(estimateEta(placed, [10], 4).toISOString()).toBe("2026-10-30T10:16:00.000Z");
    expect(estimateEta(placed, [10], 100).toISOString()).toBe("2026-10-30T10:40:00.000Z");
  });
});
