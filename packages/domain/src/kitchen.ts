import type { ItemStatus } from "@rms/contracts";

export type AgeLevel = "fresh" | "warning" | "late";

/** KDS card colour: green under 75% of prep time, amber until 100%, red after. */
export function ageLevel(placedAt: Date, prepTimeMin: number, now: Date): AgeLevel {
  const ratio = (now.getTime() - placedAt.getTime()) / (Math.max(1, prepTimeMin) * 60_000);
  if (ratio < 0.75) return "fresh";
  if (ratio < 1) return "warning";
  return "late";
}

export interface KdsItem {
  name: string;
  variantName: string | null;
  quantity: number;
  status: ItemStatus;
}

/** "8 × Butter Naan" across all tables, for batch cooking. Largest first. */
export function aggregatePending(items: readonly KdsItem[]): { name: string; variantName: string | null; quantity: number }[] {
  const map = new Map<string, { name: string; variantName: string | null; quantity: number }>();
  for (const i of items) {
    if (i.status !== "QUEUED" && i.status !== "COOKING") continue;
    const key = `${i.name}\u0000${i.variantName ?? ""}`;
    const row = map.get(key) ?? { name: i.name, variantName: i.variantName, quantity: 0 };
    row.quantity += i.quantity;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
}

/**
 * Customer ETA: order time + longest prep time among its items, pushed back by kitchen load
 * (each queued item ahead at the same station adds a fraction of its own prep time).
 * Deliberately simple; tuned later from real serve-time data.
 */
export function estimateEta(placedAt: Date, prepTimesMin: readonly number[], queuedAhead = 0): Date {
  const longest = prepTimesMin.length ? Math.max(...prepTimesMin) : 15;
  const loadMin = Math.min(30, queuedAhead * 1.5);
  return new Date(placedAt.getTime() + (longest + loadMin) * 60_000);
}
