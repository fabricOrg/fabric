import type {
  CreateCommercialOfferVersionRequest,
  Currency,
} from "@app/contracts";
import type { PricingOfferVersion, PricingOfferVersionItem } from "@app/db";

/**
 * A stored version's terms, back in the shape the create request takes.
 *
 * Cloning is the sanctioned way to change a published price: the original stays exactly as sold and
 * the copy becomes a fresh draft. Rebuilding the request rather than copying rows means the clone
 * passes the same validation as anything typed by hand — a version that could not be authored today
 * cannot re-enter through a clone.
 */
export function cloneVersionRequest(
  version: PricingOfferVersion,
  items: readonly PricingOfferVersionItem[],
): CreateCommercialOfferVersionRequest {
  return {
    currency: version.currency as Currency,
    items: items.map((item) => ({
      channel_code: item.channelCode,
      unit_code: item.unitCode,
      paid_units: item.paidUnits.toString(),
      bonus_units: item.bonusUnits.toString(),
      eligibility: {
        destination_countries: [
          ...(item.eligibility.destinationCountries ?? []),
        ],
        traffic_classes: [...(item.eligibility.trafficClasses ?? [])],
        provider_vendors: [...(item.eligibility.providerVendors ?? [])],
        service_classes: [...(item.eligibility.serviceClasses ?? [])],
      },
    })),
    total_price_minor: version.totalPriceMinor.toString(),
    credit_validity_days: version.creditValidityDays,
    minimum_pack_count: version.minimumPackCount,
    maximum_pack_count: version.maximumPackCount,
    effective_from: version.effectiveFrom.toISOString(),
    effective_to: version.effectiveTo?.toISOString() ?? null,
  };
}
