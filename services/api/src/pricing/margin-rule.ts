/**
 * The one margin rule. Extracted so CONFIGURATION time and SEND time cannot disagree.
 *
 * They disagreed in testing: the default book sold WhatsApp at GHS 0.12 against a GHS 2.00 provider
 * cost. Nothing refused the price when it was saved — the send path refused it, per message, forever,
 * as "WhatsApp sending is unavailable". A rate card that cannot be sold on is not a pricing question
 * an operator should discover from a customer-facing outage.
 *
 * Rational, not rounded: the cost numerator/denominator are compared before any division, so a
 * fractional per-unit provider rate cannot be rejected by rounding alone. This mirrors
 * buildEffectiveQuote exactly, and it is the same expression — that function calls this one.
 */
export interface MarginInput {
  /** Total sell price for the units being priced, in minor units. */
  readonly totalPriceMinor: bigint;
  /** Provider cost numerator for those same units, in minor units. */
  readonly providerCostNumerator: bigint;
  readonly providerCostDenominator: bigint;
  readonly minimumMarginBps: number;
}

export function marginSatisfied(input: MarginInput): boolean {
  const allowedCostBps = BigInt(10_000 - input.minimumMarginBps);
  return (
    input.providerCostNumerator * 10_000n <=
    input.totalPriceMinor * input.providerCostDenominator * allowedCostBps
  );
}

/**
 * The cheapest sell price that would satisfy the floor, for telling an operator what to do instead of
 * only what is wrong. Rounded UP, because the boundary value must itself pass.
 */
export function minimumSellPriceMinor(input: {
  readonly providerCostNumerator: bigint;
  readonly providerCostDenominator: bigint;
  readonly minimumMarginBps: number;
}): bigint {
  const allowedCostBps = BigInt(10_000 - input.minimumMarginBps);
  // A zero floor for allowed cost means no price can ever satisfy it; report 0 rather than divide.
  if (allowedCostBps <= 0n) return 0n;
  const numerator = input.providerCostNumerator * 10_000n;
  const denominator = input.providerCostDenominator * allowedCostBps;
  return (numerator + denominator - 1n) / denominator;
}
