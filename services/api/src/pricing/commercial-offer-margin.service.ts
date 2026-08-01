import type {
  CommercialOfferEligibility,
  CommercialOfferMarginPreview,
  Currency,
} from "@app/contracts";
import type { CommercialOfferCostSnapshot, ProvisioningDb } from "@app/db";
import {
  CommercialOfferMarginInputError,
  evaluateCommercialOfferMargin,
} from "@app/domain";
import { Inject, Injectable } from "@nestjs/common";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { resolveOfferCostBasis } from "./commercial-offer-cost.js";
import { readCostRates, readMarginFloor } from "./commercial-offer-reads.js";

export interface OfferItemTermsUnderReview {
  readonly channelCode: string;
  readonly unitCode: string;
  readonly totalUnits: bigint;
  readonly eligibility: CommercialOfferEligibility;
}

/** A package is priced once but may promise several channel-specific natural units. */
export interface OfferTermsUnderReview {
  readonly priceBookId: string;
  readonly currency: Currency;
  readonly totalPriceMinor: bigint;
  readonly items: readonly OfferItemTermsUnderReview[];
}

@Injectable()
export class CommercialOfferMarginService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  async evaluate(
    terms: OfferTermsUnderReview,
  ): Promise<CommercialOfferMarginPreview> {
    const floor = await readMarginFloor(
      this.provisioning.db,
      terms.priceBookId,
    );
    const evaluatedItems: Array<{
      index: number;
      terms: OfferItemTermsUnderReview;
      evaluation: ReturnType<typeof evaluateCommercialOfferMargin>;
    }> = [];

    for (const [index, item] of terms.items.entries()) {
      const rates = await readCostRates(
        this.provisioning.db,
        item.channelCode,
        terms.currency,
      );
      const basis = resolveOfferCostBasis(
        item.channelCode,
        item.eligibility,
        rates,
      );
      if (!basis.ok) {
        return blocked(terms, basis.failure.code, basis.failure.detail);
      }
      try {
        evaluatedItems.push({
          index,
          terms: item,
          // The per-item call supplies exact route cost evidence. Package profitability is evaluated
          // below against the sum of every item's worst route, never against these interim margins.
          evaluation: evaluateCommercialOfferMargin({
            totalUnits: item.totalUnits,
            totalPriceMinor: terms.totalPriceMinor,
            minimumMarginBps: 0,
            routes: basis.routes,
          }),
        });
      } catch (error) {
        if (error instanceof CommercialOfferMarginInputError) {
          return blocked(terms, "offer_margin_not_calculable", error.message);
        }
        throw error;
      }
    }

    const bestCost = evaluatedItems.reduce(
      (sum, item) => sum + item.evaluation.bestCase.totalCostMinor,
      0n,
    );
    const worstCost = evaluatedItems.reduce(
      (sum, item) => sum + item.evaluation.worstCase.totalCostMinor,
      0n,
    );
    const weights = evaluatedItems.map(
      (item) => item.evaluation.worstCase.totalCostMinor,
    );
    // Same posture as the per-item evaluation above: an unallocatable package is a BLOCKED verdict
    // staff can act on, not a 500. Reachable honestly — a package priced below one minor unit per
    // item, or one whose every route costs nothing.
    let allocations: bigint[];
    try {
      allocations = allocateConsideration(terms.totalPriceMinor, weights);
    } catch (error) {
      if (error instanceof CommercialOfferMarginInputError) {
        return blocked(terms, "offer_margin_not_calculable", error.message);
      }
      throw error;
    }
    const worstMargin = terms.totalPriceMinor - worstCost;
    const bestMargin = terms.totalPriceMinor - bestCost;
    const worstMarginBps = Number(
      floorDiv(worstMargin * 10_000n, terms.totalPriceMinor),
    );
    const publishable = worstMarginBps >= floor.bps;
    const routes = evaluatedItems.flatMap((item) =>
      item.evaluation.routes.map((entry) => {
        const allocated = allocations[item.index] ?? 0n;
        const margin = allocated - entry.totalCostMinor;
        return {
          item_index: item.index,
          channel_code: item.terms.channelCode,
          unit_code: item.terms.unitCode,
          provider_vendor: entry.route.providerVendor,
          destination_country: entry.route.destinationCountry,
          traffic_class: entry.route.trafficClass,
          provider_cost_rate_id: entry.route.rateId,
          source_reference: entry.route.sourceReference,
          total_cost_minor: entry.totalCostMinor.toString(),
          margin_minor: margin.toString(),
          margin_bps: Number(floorDiv(margin * 10_000n, allocated)),
          meets_floor: margin * 10_000n >= allocated * BigInt(floor.bps),
        };
      }),
    );

    return {
      currency: terms.currency,
      total_price_minor: terms.totalPriceMinor.toString(),
      items: evaluatedItems.map((item) => ({
        item_index: item.index,
        channel_code: item.terms.channelCode,
        unit_code: item.terms.unitCode,
        total_units: item.terms.totalUnits.toString(),
        best_case_cost_minor:
          item.evaluation.bestCase.totalCostMinor.toString(),
        worst_case_cost_minor:
          item.evaluation.worstCase.totalCostMinor.toString(),
        allocated_price_minor: (allocations[item.index] ?? 0n).toString(),
      })),
      cost_snapshot: {
        best_case_cost_minor: bestCost.toString(),
        worst_case_cost_minor: worstCost.toString(),
        best_case_margin_minor: bestMargin.toString(),
        worst_case_margin_minor: worstMargin.toString(),
        worst_case_margin_bps: worstMarginBps,
        minimum_margin_bps: floor.bps,
        minimum_margin_source: floor.source,
        route_count: routes.length,
        calculated_at: new Date().toISOString(),
        source_references: [
          ...new Set(routes.map((route) => route.source_reference)),
        ],
      },
      routes,
      publishable,
      blocked_reason: publishable ? null : "offer_margin_below_floor",
      blocked_detail: publishable
        ? null
        : `The package's combined worst-case cost leaves ${worstMarginBps} bps against a ${floor.bps} bps floor.`,
    };
  }
}

function blocked(
  terms: OfferTermsUnderReview,
  code: string,
  detail: string,
): CommercialOfferMarginPreview {
  return {
    currency: terms.currency,
    total_price_minor: terms.totalPriceMinor.toString(),
    items: [],
    cost_snapshot: null,
    routes: [],
    publishable: false,
    blocked_reason: code,
    blocked_detail: detail,
  };
}

/** Largest-remainder allocation: exact, deterministic, positive, and sums to package consideration. */
export function allocateConsideration(
  total: bigint,
  weights: readonly bigint[],
): bigint[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
  if (total <= 0n || weights.length === 0 || weightTotal <= 0n) {
    throw new CommercialOfferMarginInputError(
      "Package consideration cannot be allocated without positive item costs.",
    );
  }
  if (total < BigInt(weights.length)) {
    throw new CommercialOfferMarginInputError(
      "Package price is too small to allocate a positive amount to every item.",
    );
  }
  // Reserve one minor unit per item first. The remaining consideration is cost-weighted with the
  // largest-remainder method, preserving both positivity and an exact package-total reconciliation.
  const distributable = total - BigInt(weights.length);
  const bases = weights.map(
    (weight) => 1n + (distributable * weight) / weightTotal,
  );
  let remainder = total - bases.reduce((sum, value) => sum + value, 0n);
  const order = weights
    .map((weight, index) => ({
      index,
      remainder: (distributable * weight) % weightTotal,
    }))
    .sort((left, right) => {
      if (left.remainder === right.remainder) return left.index - right.index;
      return left.remainder > right.remainder ? -1 : 1;
    });
  for (const entry of order) {
    if (remainder === 0n) break;
    bases[entry.index] = (bases[entry.index] ?? 0n) + 1n;
    remainder -= 1n;
  }
  return bases;
}

function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const exact = quotient * denominator === numerator;
  return exact || numerator >= 0n === denominator > 0n
    ? quotient
    : quotient - 1n;
}

export function toStoredCostSnapshot(
  preview: CommercialOfferMarginPreview,
): CommercialOfferCostSnapshot {
  const snapshot = preview.cost_snapshot;
  if (!snapshot) {
    throw new Error("A publishable margin preview must carry a cost snapshot.");
  }
  return {
    bestCaseCostMinor: snapshot.best_case_cost_minor,
    worstCaseCostMinor: snapshot.worst_case_cost_minor,
    bestCaseMarginMinor: snapshot.best_case_margin_minor,
    worstCaseMarginMinor: snapshot.worst_case_margin_minor,
    worstCaseMarginBps: snapshot.worst_case_margin_bps,
    minimumMarginBps: snapshot.minimum_margin_bps,
    minimumMarginSource: snapshot.minimum_margin_source,
    routeCount: snapshot.route_count,
    calculatedAt: snapshot.calculated_at,
    sourceReferences: snapshot.source_references,
  };
}
