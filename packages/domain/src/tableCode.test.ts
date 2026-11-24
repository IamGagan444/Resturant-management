import { describe, expect, it } from "vitest";
import { formatTableCode, normalizeTableCode, tableCodeProblem } from "./tableCode";

describe("table codes", () => {
  it("accepts a code however it is typed", () => {
    for (const typed of ["K7M4QP", "k7m4qp", "K7M-4QP", " k7m 4qp "]) {
      expect(tableCodeProblem(typed)).toBeNull();
      expect(normalizeTableCode(typed)).toBe("K7M4QP");
    }
    expect(formatTableCode("K7M4QP")).toBe("K7M-4QP");
  });

  it("says what is wrong", () => {
    expect(tableCodeProblem("")).toBe("EMPTY");
    expect(tableCodeProblem(" - ")).toBe("EMPTY");
    expect(tableCodeProblem("K7M")).toBe("TOO_SHORT");
    expect(tableCodeProblem("K7M4QPX")).toBe("TOO_LONG");
    for (const bad of ["K7M4Q0", "K7M4QO", "K7M4Q1", "K7M4QI", "K7M4Q!", "K7M4Qé", "<scri>"]) expect(tableCodeProblem(bad)).toBe("BAD_CHARACTER");
  });
});
