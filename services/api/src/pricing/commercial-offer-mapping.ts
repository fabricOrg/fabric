import type {
  CommercialOfferCostSnapshot as CommercialOfferCostSnapshotDto,
  CommercialOfferDto,
  CommercialOfferEligibility as CommercialOfferEligibilityDto,
  CommercialOfferStatus,
  CommercialOfferVersionDto,
  CommercialOfferVersionItemDto,
  Currency,
} from "@app/contracts";
import type {
  CommercialOfferCostSnapshot,
  CommercialOfferEligibility,
  PricingOffer,
  PricingOfferVersion,
  PricingOfferVersionItem,
} from "@app/db";

/**
 * Row ⇄ DTO conversion for commercial offers. The two shapes differ deliberately: the wire contract
 * is snake_case with every eligibility dimension PRESENT (an absent key and an empty list must not be
 * two ways of saying the same thing at a boundary), while the stored jsonb keeps optional camelCase
 * keys so an offer authored before a dimension existed does not grow a fabricated empty one.
 */

export function toStoredEligibility(
  eligibility: CommercialOfferEligibilityDto,
): CommercialOfferEligibility {
  return {
    destinationCountries: eligibility.destination_countries,
    trafficClasses: eligibility.traffic_classes,
    providerVendors: eligibility.provider_vendors,
    serviceClasses: eligibility.service_classes,
  };
}

export function toEligibilityDto(
  stored: CommercialOfferEligibility | null,
): CommercialOfferEligibilityDto {
  return {
    destination_countries: [...(stored?.destinationCountries ?? [])],
    traffic_classes: [...(stored?.trafficClasses ?? [])],
    provider_vendors: [...(stored?.providerVendors ?? [])],
    service_classes: [...(stored?.serviceClasses ?? [])],
  };
}

function toCostSnapshotDto(
  stored: CommercialOfferCostSnapshot | null,
): CommercialOfferCostSnapshotDto | null {
  if (!stored) return null;
  return {
    best_case_cost_minor: stored.bestCaseCostMinor,
    worst_case_cost_minor: stored.worstCaseCostMinor,
    best_case_margin_minor: stored.bestCaseMarginMinor,
    worst_case_margin_minor: stored.worstCaseMarginMinor,
    worst_case_margin_bps: stored.worstCaseMarginBps,
    minimum_margin_bps: stored.minimumMarginBps,
    minimum_margin_source: stored.minimumMarginSource,
    route_count: stored.routeCount,
    calculated_at: stored.calculatedAt,
    source_references: [...stored.sourceReferences],
  };
}

export function toOfferDto(row: PricingOffer): CommercialOfferDto {
  return {
    id: row.id,
    price_book_id: row.priceBookId,
    code: row.code,
    name: row.name,
    description: row.description,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Staff emails are resolved for display only; the id on the row stays the authoritative actor. */
export function toVersionDto(
  row: PricingOfferVersion,
  staffEmails: ReadonlyMap<string, string>,
  items: readonly PricingOfferVersionItem[],
): CommercialOfferVersionDto {
  return {
    id: row.id,
    offer_id: row.offerId,
    version: row.version,
    status: row.status as CommercialOfferStatus,
    currency: row.currency as Currency,
    items: [...items]
      .sort((left, right) => left.position - right.position)
      .map(toVersionItemDto),
    total_price_minor: row.totalPriceMinor.toString(),
    credit_validity_days: row.creditValidityDays,
    minimum_pack_count: row.minimumPackCount,
    maximum_pack_count: row.maximumPackCount,
    cost_snapshot: toCostSnapshotDto(row.costSnapshot),
    effective_from: row.effectiveFrom.toISOString(),
    effective_to: row.effectiveTo?.toISOString() ?? null,
    created_by: row.createdBy,
    approved_by: row.approvedBy,
    approved_at: row.approvedAt?.toISOString() ?? null,
    created_by_email: staffEmails.get(row.createdBy) ?? null,
    approved_by_email: row.approvedBy
      ? (staffEmails.get(row.approvedBy) ?? null)
      : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function toVersionItemDto(
  row: PricingOfferVersionItem,
): CommercialOfferVersionItemDto {
  return {
    id: row.id,
    position: row.position,
    channel_code: row.channelCode,
    unit_code: row.unitCode,
    paid_units: row.paidUnits.toString(),
    bonus_units: row.bonusUnits.toString(),
    total_units: row.totalUnits.toString(),
    eligibility: toEligibilityDto(row.eligibility),
    allocated_price_minor: row.allocatedPriceMinor?.toString() ?? null,
  };
}
