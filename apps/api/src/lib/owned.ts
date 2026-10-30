import { db } from "@rms/db";
import { badRequest } from "./errors";

/**
 * Foreign keys only prove a row exists, not that it belongs to this tenant.
 * Every id taken from input and written as an FK (or used in `connect`) must pass through here.
 * Runs inside withTenant(), so the counts are tenant-scoped.
 */
type Kind = "category" | "station" | "tax" | "addonGroup" | "floor" | "table" | "staff";

const counters: Record<Kind, (ids: string[]) => Promise<number>> = {
  category: (ids) => db.menuCategory.count({ where: { id: { in: ids } } }),
  station: (ids) => db.station.count({ where: { id: { in: ids } } }),
  tax: (ids) => db.tax.count({ where: { id: { in: ids } } }),
  addonGroup: (ids) => db.addonGroup.count({ where: { id: { in: ids } } }),
  floor: (ids) => db.floor.count({ where: { id: { in: ids } } }),
  table: (ids) => db.table.count({ where: { id: { in: ids } } }),
  staff: (ids) => db.staff.count({ where: { id: { in: ids } } }),
};

export async function assertOwned(kind: Kind, ids: readonly (string | null | undefined)[]): Promise<void> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return;
  if ((await counters[kind](unique)) !== unique.length) throw badRequest("INVALID_REFERENCE", `Unknown ${kind} id`);
}
