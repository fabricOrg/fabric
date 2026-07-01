/**
 * Rating (F5.2) — PURE. Cost = segments × per-segment price for the destination. Thin-thread pricing
 * is a flat per-(currency) rate table; real destination/operator pricing is a fast-follow (F6.4
 * success-based SKU repricing is additive — see the reconciliation note). Money is minor units.
 */

/** Per-segment price in minor units, keyed by currency (thin-thread flat table). */
export type RateTable = Readonly<Record<string, bigint>>;

export const DEFAULT_RATES: RateTable = {
  GHS: 3n, // 0.03 GHS / segment (pesewas)
  NGN: 400n, // 4.00 NGN / segment (kobo)
  USD: 1n, // 0.01 USD / segment (cents)
};

export class UnknownCurrencyError extends Error {
  constructor(readonly currency: string) {
    super(`no per-segment rate configured for currency ${currency}`);
    this.name = "UnknownCurrencyError";
  }
}

/** cost_minor = segments × rate[currency]. Rejects an unpriced currency (never silently charge 0). */
export function rateSegments(
  segments: number,
  currency: string,
  rates: RateTable = DEFAULT_RATES,
): bigint {
  const per = rates[currency];
  if (per === undefined) throw new UnknownCurrencyError(currency);
  return BigInt(segments) * per;
}
