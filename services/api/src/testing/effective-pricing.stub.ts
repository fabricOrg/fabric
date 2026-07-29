import type { PricingSnapshot } from "@app/db";
import { DEFAULT_RATES } from "@app/domain";
import type {
  EffectivePriceInput,
  EffectivePriceQuote,
} from "../pricing/effective-pricing.js";
import type { EffectivePricingService } from "../pricing/effective-pricing.service.js";

export function effectivePricingStub(): EffectivePricingService {
  return {
    quote: async (input: EffectivePriceInput): Promise<EffectivePriceQuote> => {
      const unitPriceMinor = DEFAULT_RATES.GHS ?? 5n;
      const totalPriceMinor = unitPriceMinor * input.units;
      const snapshot: PricingSnapshot = {
        priceBookVersionId: "00000000-0000-4000-8000-000000000001",
        sellRuleId: "00000000-0000-4000-8000-000000000002",
        providerCostRateId: "00000000-0000-4000-8000-000000000003",
        channel: input.channel,
        currency: "GHS",
        unitBasis: input.channel === "sms" ? "segment" : "recipient",
        units: input.units.toString(),
        unitPriceMinor: unitPriceMinor.toString(),
        totalPriceMinor: totalPriceMinor.toString(),
        providerCostNumeratorMinor: "1",
        providerCostDenominator: "1",
        estimatedProviderCostMinor: input.units.toString(),
        expectedMarginMinor: (totalPriceMinor - input.units).toString(),
        providerVendor: input.providerVendor,
      };
      return {
        currency: "GHS",
        unitPriceMinor,
        totalPriceMinor,
        estimatedProviderCostMinor: input.units,
        expectedMarginMinor: totalPriceMinor - input.units,
        snapshot,
      };
    },
  } as EffectivePricingService;
}
