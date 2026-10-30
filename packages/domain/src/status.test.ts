import { describe, expect, it } from "vitest";
import { checkItemTransition, deriveOrderStatus, stampsFor, trackerStep } from "./status";

describe("checkItemTransition", () => {
  it("allows the cook's happy path", () => {
    expect(checkItemTransition("QUEUED", "COOKING", "COOK")).toEqual({ ok: true });
    expect(checkItemTransition("COOKING", "READY", "COOK")).toEqual({ ok: true });
    expect(checkItemTransition("QUEUED", "READY", "COOK")).toEqual({ ok: true }); // bump
  });

  it("allows the waiter's happy path", () => {
    expect(checkItemTransition("READY", "PICKED_UP", "WAITER")).toEqual({ ok: true });
    expect(checkItemTransition("PICKED_UP", "SERVED", "WAITER")).toEqual({ ok: true });
    expect(checkItemTransition("READY", "SERVED", "WAITER")).toEqual({ ok: true });
  });

  it("treats stale/backward commands as NOOP (offline replay safety)", () => {
    expect(checkItemTransition("READY", "COOKING", "COOK")).toEqual({ ok: false, reason: "NOOP" });
    expect(checkItemTransition("SERVED", "PICKED_UP", "WAITER")).toEqual({ ok: false, reason: "NOOP" });
    expect(checkItemTransition("COOKING", "COOKING", "COOK")).toEqual({ ok: false, reason: "NOOP" });
    expect(checkItemTransition("CANCELLED", "READY", "COOK")).toEqual({ ok: false, reason: "NOOP" });
  });

  it("enforces roles", () => {
    expect(checkItemTransition("READY", "PICKED_UP", "COOK")).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(checkItemTransition("QUEUED", "COOKING", "WAITER")).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(checkItemTransition("COOKING", "CANCELLED", "WAITER")).toEqual({ ok: false, reason: "FORBIDDEN" });
    expect(checkItemTransition("COOKING", "CANCELLED", "MANAGER")).toEqual({ ok: true });
    expect(checkItemTransition("OUT_OF_STOCK", "CANCELLED", "CUSTOMER")).toEqual({ ok: true });
  });

  it("rejects impossible edges", () => {
    expect(checkItemTransition("SERVED", "CANCELLED", "MANAGER")).toEqual({ ok: false, reason: "INVALID" });
    expect(checkItemTransition("PICKED_UP", "OUT_OF_STOCK", "MANAGER")).toEqual({ ok: false, reason: "INVALID" });
  });
});

describe("stampsFor", () => {
  const now = new Date("2026-10-30T10:00:00Z");
  it("stamps skipped steps", () => {
    expect(stampsFor("READY", "SERVED", now)).toEqual({ pickedUpAt: now, servedAt: now });
  });
  it("does not invent startedAt when cook bumps straight to ready", () => {
    expect(stampsFor("QUEUED", "READY", now)).toEqual({ readyAt: now });
  });
  it("sets startedAt on start", () => {
    expect(stampsFor("QUEUED", "COOKING", now)).toEqual({ startedAt: now });
  });
  it("keeps existing stamps", () => {
    const earlier = new Date("2026-10-30T09:00:00Z");
    expect(stampsFor("READY", "SERVED", now, { pickedUpAt: earlier })).toEqual({ servedAt: now });
  });
});

describe("deriveOrderStatus", () => {
  const s = (...st: Parameters<typeof trackerStep>[0][]) => st.map((status) => ({ status }));
  it("follows item progress", () => {
    expect(deriveOrderStatus("PLACED", s("QUEUED", "QUEUED"))).toBe("PLACED");
    expect(deriveOrderStatus("PLACED", s("COOKING", "QUEUED"))).toBe("IN_PROGRESS");
    expect(deriveOrderStatus("IN_PROGRESS", s("READY", "PICKED_UP"))).toBe("READY");
    expect(deriveOrderStatus("READY", s("SERVED", "CANCELLED"))).toBe("SERVED");
    expect(deriveOrderStatus("PLACED", s("CANCELLED"))).toBe("CANCELLED");
  });
  it("keeps held statuses", () => {
    expect(deriveOrderStatus("AWAITING_PAYMENT", s("QUEUED"))).toBe("AWAITING_PAYMENT");
    expect(deriveOrderStatus("PENDING_CONFIRMATION", s("QUEUED"))).toBe("PENDING_CONFIRMATION");
  });
});

describe("trackerStep", () => {
  it("maps statuses to customer language", () => {
    expect(trackerStep("QUEUED")).toBe("RECEIVED");
    expect(trackerStep("PICKED_UP")).toBe("ON_THE_WAY");
    expect(trackerStep("SERVED")).toBe("SERVED");
  });
});
