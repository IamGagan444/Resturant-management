/** What staff and guests see instead of a table name for a walk-in parcel. */
export const parcelLabel = (parcelNo: number) => `Parcel ${parcelNo}`;

/** Token number if this label is a walk-in parcel, else null. */
export function parcelNumber(label: string): number | null {
  const m = /^Parcel (\d+)$/.exec(label);
  return m ? Number(m[1]) : null;
}

/** A dish that became ready this long before the bill was paid may still be on the pass; older ones were carried out. */
export const PAID_PASS_MS = 10 * 60_000;

/** Paid parcels stay on the pick-up list this long after ordering, then count as forgotten taps. */
export const PAID_PARCEL_LIST_MS = 12 * 3600_000;
