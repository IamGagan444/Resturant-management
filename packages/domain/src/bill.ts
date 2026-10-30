import { allocate, roundHalfUp, sum } from "./money";

export interface TaxRate {
  name: string; // CGST
  rateBps: number; // 250
}

export interface BillLineInput {
  /** unitPrice × quantity, in paise, as priced on the menu */
  amount: number;
  taxes: readonly TaxRate[];
}

export interface BillOptions {
  pricesIncludeTax: boolean;
  discount: number; // paise, applied before tax
  serviceChargeBps: number; // 0 = none
}

export interface BillTaxLine {
  name: string;
  rateBps: number;
  taxable: number;
  amount: number;
}

export interface BillTotals {
  subtotal: number; // Σ line amounts (menu prices)
  discount: number;
  serviceCharge: number;
  taxLines: BillTaxLine[];
  taxTotal: number;
  roundOff: number; // to nearest rupee, may be negative
  total: number;
}

/**
 * GST bill computation.
 *
 * - Lines are grouped into buckets by identical tax set (e.g. CGST 2.5 + SGST 2.5).
 * - Discount is allocated across buckets pro-rata and reduces the taxable value.
 * - Service charge is computed on the pre-tax value and taxed at the bucket's rates
 *   (it is part of the consideration for the supply).
 * - Tax-inclusive menus: tax is backed out of the price; rounding is absorbed into the taxable value
 *   so the customer pays exactly the menu price.
 * - Total is rounded to the nearest rupee; the difference is shown as round-off.
 *
 * Every split uses largest-remainder allocation, so parts always sum exactly.
 */
export function computeBill(lines: readonly BillLineInput[], opts: BillOptions): BillTotals {
  const buckets = new Map<string, { taxes: TaxRate[]; gross: number }>();
  for (const l of lines) {
    if (!Number.isInteger(l.amount) || l.amount < 0) throw new Error("Line amount must be a non-negative integer");
    const taxes = [...l.taxes].sort((a, b) => a.name.localeCompare(b.name) || a.rateBps - b.rateBps);
    const key = taxes.map((t) => `${t.name}@${t.rateBps}`).join("|");
    const b = buckets.get(key) ?? { taxes, gross: 0 };
    b.gross += l.amount;
    buckets.set(key, b);
  }
  const list = [...buckets.values()];
  const subtotal = sum(list.map((b) => b.gross));
  const discount = Math.min(Math.max(0, Math.trunc(opts.discount)), subtotal);
  const discShares = allocate(discount, list.map((b) => b.gross));

  const food = list.map((b, i) => {
    const net = b.gross - (discShares[i] ?? 0);
    const sumBps = sum(b.taxes.map((t) => t.rateBps));
    const taxable = opts.pricesIncludeTax ? roundHalfUp((net * 10_000) / (10_000 + sumBps)) : net;
    return { ...b, net, taxable };
  });

  const serviceCharge = roundHalfUp((sum(food.map((f) => f.taxable)) * opts.serviceChargeBps) / 10_000);
  const scShares = allocate(serviceCharge, food.map((f) => f.taxable));

  const agg = new Map<string, BillTaxLine>();
  let preRound = 0;
  food.forEach((f, i) => {
    const sc = scShares[i] ?? 0;
    let foodTaxes: number[];
    if (opts.pricesIncludeTax) {
      foodTaxes = allocate(f.net - f.taxable, f.taxes.map((t) => t.rateBps));
    } else {
      foodTaxes = f.taxes.map((t) => roundHalfUp((f.taxable * t.rateBps) / 10_000));
    }
    let bucketTax = 0;
    f.taxes.forEach((t, j) => {
      const amount = (foodTaxes[j] ?? 0) + roundHalfUp((sc * t.rateBps) / 10_000);
      bucketTax += amount;
      const k = `${t.name}@${t.rateBps}`;
      const line = agg.get(k) ?? { name: t.name, rateBps: t.rateBps, taxable: 0, amount: 0 };
      line.taxable += f.taxable + sc;
      line.amount += amount;
      agg.set(k, line);
    });
    preRound += f.taxable + sc + bucketTax;
  });

  const taxLines = [...agg.values()].sort((a, b) => a.name.localeCompare(b.name) || a.rateBps - b.rateBps);
  const taxTotal = sum(taxLines.map((t) => t.amount));
  const total = roundHalfUp(preRound / 100) * 100;
  return { subtotal, discount, serviceCharge, taxLines, taxTotal, roundOff: total - preRound, total };
}

/** Equal split: parts differ by at most 1 paisa and sum to total. */
export function splitEqual(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1) throw new Error("parts must be >= 1");
  return allocate(total, Array.from({ length: parts }, () => 1));
}

/**
 * Split by guest / by item: each group pays the bill total pro-rata to its menu-price share,
 * so discount, service charge, tax and round-off are distributed consistently.
 */
export function splitProportional(total: number, groupAmounts: readonly number[]): number[] {
  return allocate(total, groupAmounts);
}
