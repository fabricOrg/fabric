import { describe, expect, it } from "vitest";
import {
  buildEffectiveQuote,
  type EffectivePriceConfig,
  PricingMarginViolationError,
  UNIT_BASIS_BY_CHANNEL,
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
  it("maps each billable channel to its unit basis", () => {
    expect(UNIT_BASIS_BY_CHANNEL).toEqual({
      sms: "segment",
      email: "recipient",
      whatsapp: "message",
    });
  });

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

  it("uses exact bigint minor-unit arithmetic for whatsapp messages", () => {
    const quote = buildEffectiveQuote(
      {
        accountId: "account-1",
        channel: "whatsapp",
        units: 7n,
        providerVendor: "meta-cloud",
        destinationCountry: "GH",
        trafficClass: "marketing",
      },
      {
        ...config,
        unitBasis: "message",
        unitPriceMinor: 13n,
        providerCostNumeratorMinor: 31n,
        providerCostDenominator: 4n,
      },
    );

    expect(quote.totalPriceMinor).toBe(91n);
    expect(quote.estimatedProviderCostMinor).toBe(55n);
    expect(quote.expectedMarginMinor).toBe(36n);
    expect(quote.snapshot).toEqual(
      expect.objectContaining({
        channel: "whatsapp",
        unitBasis: "message",
        units: "7",
        totalPriceMinor: "91",
        estimatedProviderCostMinor: "55",
        trafficClass: "marketing",
      }),
    );
  });
});
