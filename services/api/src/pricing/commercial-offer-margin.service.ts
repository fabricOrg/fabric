import type {
  CommercialOfferEligibility,
  CommercialOfferMarginPreview,
  Currency,
} from "@app/contracts";
import type { CommercialOfferCostSnapshot, ProvisioningDb } from "@app/db";
import {
  type CommercialOfferMarginEvaluation,
  CommercialOfferMarginInputError,
  evaluateCommercialOfferMargin,
} from "@app/domain";
import { Inject, Injectable } from "@nestjs/common";
import { PROVISIONING_DB } from "../identity/provisioning-db.module.js";
import { resolveOfferCostBasis } from "./commercial-offer-cost.js";
import { readCostRates, readMarginFloor } from "./commercial-offer-reads.js";

/** The commercial terms a margin verdict is computed from — a saved version or an unsaved draft. */
export interface OfferTermsUnderReview {
  readonly channelCode: string;
  readonly priceBookId: string;
  readonly currency: Currency;
  readonly totalUnits: bigint;
  readonly totalPriceMinor: bigint;
  readonly eligibility: CommercialOfferEligibility;
}

/**
 * The publish-time margin gate (ADR-0012 §9), served two ways from ONE code path: as a preview the
 * authoring form renders, and as the verdict `publish` refuses on. Sharing the path is the point —
 * a preview that could disagree with the gate would be worse than no preview.
 */
@Injectable()
export class CommercialOfferMarginService {
  constructor(
    @Inject(PROVISIONING_DB) private readonly provisioning: ProvisioningDb,
  ) {}

  async evaluate(
    terms: OfferTermsUnderReview,
  ): Promise<CommercialOfferMarginPreview> {
    const base = {
      currency: terms.currency,
      total_units: terms.totalUnits.toString(),
      total_price_minor: terms.totalPriceMinor.toString(),
      effective_unit_price_minor_display: effectiveUnitPrice(
        terms.totalPriceMinor,
        terms.totalUnits,
      ),
    };

    const [rates, floor] = await Promise.all([
      readCostRates(this.provisioning.db, terms.channelCode, terms.currency),
      readMarginFloor(this.provisioning.db, terms.priceBookId),
    ]);

    const basis = resolveOfferCostBasis(
      terms.channelCode,
      terms.eligibility,
      rates,
    );
    if (!basis.ok) {
      return {
        ...base,
        cost_snapshot: null,
        routes: [],
        publishable: false,
        blocked_reason: basis.failure.code,
        blocked_detail: basis.failure.detail,
      };
    }

    let evaluation: CommercialOfferMarginEvaluation;
    try {
      evaluation = evaluateCommercialOfferMargin({
        totalUnits: terms.totalUnits,
        totalPriceMinor: terms.totalPriceMinor,
        minimumMarginBps: floor.bps,
        routes: basis.routes,
      });
    } catch (error) {
      // The domain refuses inputs that cannot support a verdict at all. Surfacing that as "not
      // publishable" keeps the gate closed instead of letting an exception read as an unrelated 500.
      if (error instanceof CommercialOfferMarginInputError) {
        return {
          ...base,
          cost_snapshot: null,
          routes: [],
          publishable: false,
          blocked_reason: "offer_margin_not_calculable",
          blocked_detail: error.message,
        };
      }
      throw error;
    }

    const routes = evaluation.routes.map((entry) => ({
      provider_vendor: entry.route.providerVendor,
      destination_country: entry.route.destinationCountry,
      traffic_class: entry.route.trafficClass,
      provider_cost_rate_id: entry.route.rateId,
      source_reference: entry.route.sourceReference,
      total_cost_minor: entry.totalCostMinor.toString(),
      margin_minor: entry.marginMinor.toString(),
      margin_bps: entry.marginBps,
      meets_floor: entry.meetsFloor,
    }));

    return {
      ...base,
      cost_snapshot: {
        best_case_cost_minor: evaluation.bestCase.totalCostMinor.toString(),
        worst_case_cost_minor: evaluation.worstCase.totalCostMinor.toString(),
        best_case_margin_minor: evaluation.bestCase.marginMinor.toString(),
        worst_case_margin_minor: evaluation.worstCase.marginMinor.toString(),
        worst_case_margin_bps: evaluation.worstCase.marginBps,
        minimum_margin_bps: floor.bps,
        minimum_margin_source: floor.source,
        route_count: routes.length,
        calculated_at: new Date().toISOString(),
        source_references: distinctReferences(evaluation),
      },
      routes,
      publishable: evaluation.meetsFloor,
      blocked_reason: evaluation.meetsFloor ? null : "offer_margin_below_floor",
      blocked_detail: evaluation.meetsFloor
        ? null
        : `The worst permitted route (${describe(evaluation)}) leaves ${evaluation.worstCase.marginBps} bps against a ${floor.bps} bps floor.`,
    };
  }
}

/**
 * The stored form of a preview's evidence. Only ever called with a preview the gate has PASSED, so a
 * missing snapshot here is a programming error rather than a business state.
 */
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

function distinctReferences(
  evaluation: CommercialOfferMarginEvaluation,
): string[] {
  const references = evaluation.routes
    .map((entry) => entry.route.sourceReference)
    .filter((reference) => reference.length > 0);
  return [...new Set(references)];
}

function describe(evaluation: CommercialOfferMarginEvaluation): string {
  const { route } = evaluation.worstCase;
  return [
    route.providerVendor,
    route.destinationCountry ?? "any destination",
    route.trafficClass ?? "any traffic class",
  ].join(" / ");
}

/**
 * Informational only, and never the financial truth: a fixed total need not divide evenly by its
 * units. Four decimal places of minor units, computed with integer math so the display cannot drift
 * from the exact total the customer is charged.
 */
function effectiveUnitPrice(
  totalPriceMinor: bigint,
  totalUnits: bigint,
): string {
  if (totalUnits <= 0n) return "0.0000";
  const scaled = (totalPriceMinor * 10_000n) / totalUnits;
  const whole = scaled / 10_000n;
  const fraction = (scaled % 10_000n).toString().padStart(4, "0");
  return `${whole}.${fraction}`;
}
