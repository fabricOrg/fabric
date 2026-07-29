import { describe, expect, it } from "vitest";
import {
  buildEffectiveQuote,
  type EffectivePriceConfig,
  PricingMarginViolationError,
} from "./effective-pricing.js";

const config: EffectivePriceConfig = {
  priceBookVersionId: "version-1",
  sellRuleId: "sell-1",
  providerCostRateId: "cost-1",
  currency: "GHS",
  unitBasis: "segment",
  unitPriceMinor: 8n,
  providerCostNumeratorMinor: 9n,
  providerCostDenominator: 2n,
  minimumMarginBps: 2_000,
};

describe("buildEffectiveQuote", () => {
  it("uses exact bigint arithmetic and snapshots the resolved inputs", () => {
    const quote = buildEffectiveQuote(
      {
        accountId: "account-1",
        channel: "sms",
        units: 3n,
        providerVendor: "arkesel",
        destinationCountry: "GH",
        trafficClass: "transactional",
      },
      config,
    );

    expect(quote.totalPriceMinor).toBe(24n);
    expect(quote.estimatedProviderCostMinor).toBe(14n);
    expect(quote.expectedMarginMinor).toBe(10n);
    expect(quote.snapshot).toEqual({
      priceBookVersionId: "version-1",
      sellRuleId: "sell-1",
      providerCostRateId: "cost-1",
      channel: "sms",
      currency: "GHS",
      unitBasis: "segment",
      units: "3",
      unitPriceMinor: "8",
      totalPriceMinor: "24",
      providerCostNumeratorMinor: "9",
      providerCostDenominator: "2",
      estimatedProviderCostMinor: "14",
      expectedMarginMinor: "10",
      providerVendor: "arkesel",
      destinationCountry: "GH",
      trafficClass: "transactional",
    });
  });

  it("checks margin against the exact rational provider cost", () => {
    expect(() =>
      buildEffectiveQuote(
        {
          accountId: "account-1",
          channel: "sms",
          units: 1n,
          providerVendor: "arkesel",
        },
        { ...config, unitPriceMinor: 5n, minimumMarginBps: 2_000 },
      ),
    ).toThrow(PricingMarginViolationError);
  });
});
