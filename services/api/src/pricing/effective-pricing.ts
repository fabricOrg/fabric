import type { PricingSnapshot } from "@app/db";

export type BillableChannel = "sms" | "email" | "whatsapp";
export type TrafficClass =
  | "promotional"
  | "transactional"
  | "otp"
  | "marketing"
  | "utility"
  | "authentication";
export type UnitBasis = "segment" | "recipient" | "message";

export const UNIT_BASIS_BY_CHANNEL: Record<BillableChannel, UnitBasis> = {
  sms: "segment",
  email: "recipient",
  whatsapp: "message",
};

export interface EffectivePriceInput {
  readonly accountId: string;
  readonly channel: BillableChannel;
  readonly units: bigint;
  /** Stable plugin slug, not a display label. */
  readonly providerVendor: string;
  readonly destinationCountry?: string;
  readonly trafficClass?: TrafficClass;
}

export interface EffectivePriceQuote {
  readonly currency: string;
  readonly unitPriceMinor: bigint;
  readonly totalPriceMinor: bigint;
  readonly estimatedProviderCostMinor: bigint;
  readonly expectedMarginMinor: bigint;
  readonly snapshot: PricingSnapshot;
}

export interface EffectivePriceConfig {
  readonly priceBookVersionId: string;
  readonly sellRuleId: string;
  readonly providerCostRateId: string;
  readonly currency: string;
  readonly unitBasis: UnitBasis;
  readonly unitPriceMinor: bigint;
  readonly providerCostNumeratorMinor: bigint;
  readonly providerCostDenominator: bigint;
  readonly minimumMarginBps: number;
}

export class EffectivePricingUnavailableError extends Error {
  readonly code = "effective_pricing_unavailable";

  constructor(message: string) {
    super(message);
    this.name = "EffectivePricingUnavailableError";
  }
}

export class PricingMarginViolationError extends Error {
  readonly code = "pricing_margin_violation";

  constructor() {
    super(
      "The effective sell price does not satisfy the configured margin floor.",
    );
    this.name = "PricingMarginViolationError";
  }
}

export function buildEffectiveQuote(
  input: EffectivePriceInput,
  config: EffectivePriceConfig,
): EffectivePriceQuote {
  if (input.units <= 0n) {
    throw new EffectivePricingUnavailableError(
      "Billable units must be greater than zero.",
    );
  }
  if (
    config.providerCostNumeratorMinor <= 0n ||
    config.providerCostDenominator <= 0n
  ) {
    throw new EffectivePricingUnavailableError(
      "The provider cost ratio is invalid.",
    );
  }

  const totalPriceMinor = input.units * config.unitPriceMinor;
  const providerCostNumerator = input.units * config.providerCostNumeratorMinor;
  const estimatedProviderCostMinor =
    (providerCostNumerator + config.providerCostDenominator - 1n) /
    config.providerCostDenominator;

  // Compare the rational cost before rounding. Rounding provider cost upward is useful for reports,
  // but must not create a false margin rejection for a valid fractional per-unit provider rate.
  const allowedCostBps = BigInt(10_000 - config.minimumMarginBps);
  const marginSatisfied =
    providerCostNumerator * 10_000n <=
    totalPriceMinor * config.providerCostDenominator * allowedCostBps;
  if (!marginSatisfied) throw new PricingMarginViolationError();

  const expectedMarginMinor = totalPriceMinor - estimatedProviderCostMinor;
  const snapshot: PricingSnapshot = {
    priceBookVersionId: config.priceBookVersionId,
    sellRuleId: config.sellRuleId,
    providerCostRateId: config.providerCostRateId,
    channel: input.channel,
    currency: config.currency,
    unitBasis: config.unitBasis,
    units: input.units.toString(),
    unitPriceMinor: config.unitPriceMinor.toString(),
    totalPriceMinor: totalPriceMinor.toString(),
    providerCostNumeratorMinor: config.providerCostNumeratorMinor.toString(),
    providerCostDenominator: config.providerCostDenominator.toString(),
    estimatedProviderCostMinor: estimatedProviderCostMinor.toString(),
    expectedMarginMinor: expectedMarginMinor.toString(),
    providerVendor: input.providerVendor,
    ...(input.destinationCountry
      ? { destinationCountry: input.destinationCountry }
      : {}),
    ...(input.trafficClass ? { trafficClass: input.trafficClass } : {}),
  };

  return {
    currency: config.currency,
    unitPriceMinor: config.unitPriceMinor,
    totalPriceMinor,
    estimatedProviderCostMinor,
    expectedMarginMinor,
    snapshot,
  };
}
