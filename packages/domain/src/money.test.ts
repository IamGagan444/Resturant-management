import { describe, expect, it } from "vitest";
import { allocate, roundHalfUp } from "./money";

describe("roundHalfUp", () => {
  it("rounds halves away from zero", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });
});

describe("allocate", () => {
  it("always sums to total", () => {
    for (const [total, weights] of [
      [100, [1, 1, 1]],
      [1, [1, 1, 1]],
      [9999, [3, 7, 11, 13]],
      [0, [5, 5]],
    ] as const) {
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("gives remainder to largest fractions, ties to earlier index", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(10, [1, 2, 7])).toEqual([1, 2, 7]);
  });

  it("puts everything on the first slot when weights are all zero", () => {
    expect(allocate(50, [0, 0])).toEqual([50, 0]);
  });
});
