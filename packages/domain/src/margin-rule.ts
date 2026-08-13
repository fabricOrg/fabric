/**
 * The margin floor rule. ONE copy, in domain, because every place that decides "is this price
 * sellable" must decide it identically.
 *
 * There were three: the pay-as-you-go quote, the commercial-offer publish gate, and (briefly) a
 * fourth added alongside the config-time guard. Two of them disagreeing is exactly how a price book
 * came to hold a rate the send path refused on every message — the operator saw a clean save and the
 * customer saw a dead channel.
 *
 * Rational, not rounded: the cost numerator and denominator are compared before any division, so a
 * fractional per-unit provider rate is never rejected by a rounding artefact it did not cause.
 */
export interface MarginInput {
  /** Total sell price for the units being priced, in minor units. */
  readonly totalPriceMinor: bigint;
  /** Provider cost numerator for those SAME units, in minor units. */
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
 * The cheapest sell price that satisfies the floor, so a refusal can say what to do instead of only
 * what is wrong. Rounded UP, because the boundary value must itself pass.
 *
 * Returns null at a 100% floor: no positive price can ever satisfy it, and a "charge at least 0.00"
 * message would name a price the DB's `unit_price_minor > 0` check forbids anyway. Callers must say
 * something else in that case rather than print a number.
 */
export function minimumSellPriceMinor(input: {
  readonly providerCostNumerator: bigint;
  readonly providerCostDenominator: bigint;
  readonly minimumMarginBps: number;
}): bigint | null {
  const allowedCostBps = BigInt(10_000 - input.minimumMarginBps);
  if (allowedCostBps <= 0n) return null;
  const numerator = input.providerCostNumerator * 10_000n;
  const denominator = input.providerCostDenominator * allowedCostBps;
  return (numerator + denominator - 1n) / denominator;
}
