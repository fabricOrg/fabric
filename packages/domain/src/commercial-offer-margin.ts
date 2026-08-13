import { marginSatisfied } from "./margin-rule.js";
/**
 * Publish-time margin evaluation for a fixed-total commercial offer (ADR-0012 §9).
 *
 * A bundle is consumable on EVERY route its eligibility permits, so the gate is the worst permitted
 * route — not an average, and not the route staff had in mind while authoring. Costs arrive as the
 * rational form the provider-cost table stores (`numeratorMinor` per `denominator` units) so a
 * fractional per-unit carrier rate never has to be rounded before it is compared.
 *
 * Channel-agnostic on purpose: SMS segments, email recipients, and any later registered unit are all
 * just "units" here. bigint only — no float ever touches money.
 */

export interface CommercialOfferRouteRate {
  /** The provider-cost rate row this evidence came from. */
  readonly rateId: string;
  readonly providerVendor: string;
  readonly destinationCountry: string | null;
  readonly trafficClass: string | null;
  readonly sourceReference: string;
  /** Provider cost of `denominator` units, in minor units. */
  readonly numeratorMinor: bigint;
  readonly denominator: bigint;
}

export interface CommercialOfferMarginInput {
  readonly totalUnits: bigint;
  readonly totalPriceMinor: bigint;
  /** The catalog's margin floor in basis points (0–10000). */
  readonly minimumMarginBps: number;
  readonly routes: readonly CommercialOfferRouteRate[];
}

export interface CommercialOfferRouteMargin {
  readonly route: CommercialOfferRouteRate;
  /** Provider cost for the offer's full unit count on this route, rounded UP. */
  readonly totalCostMinor: bigint;
  readonly marginMinor: bigint;
  /** Margin as basis points of the total price, floored. Negative when the route sells below cost. */
  readonly marginBps: number;
  readonly meetsFloor: boolean;
}

export interface CommercialOfferMarginEvaluation {
  readonly routes: readonly CommercialOfferRouteMargin[];
  /** Cheapest permitted route — informational; it is never what the gate decides on. */
  readonly bestCase: CommercialOfferRouteMargin;
  readonly worstCase: CommercialOfferRouteMargin;
  readonly meetsFloor: boolean;
}

export class CommercialOfferMarginInputError extends Error {
  readonly code = "commercial_offer_margin_input_invalid";

  constructor(message: string) {
    super(message);
    this.name = "CommercialOfferMarginInputError";
  }
}

/** Floor division for bigints — `/` truncates toward zero, which would flatter a negative margin. */
function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const exact = quotient * denominator === numerator;
  return exact || numerator >= 0n === denominator > 0n
    ? quotient
    : quotient - 1n;
}

/** True when this route's cost leaves at least `minimumMarginBps` of the price as margin. */
function satisfiesFloor(
  input: CommercialOfferMarginInput,
  route: CommercialOfferRouteRate,
): boolean {
  // The shared rule, not a local copy. This WAS a copy, byte-identical to the quote's — which is how
  // three spellings of one decision ended up in the tree.
  return marginSatisfied({
    totalPriceMinor: input.totalPriceMinor,
    providerCostNumerator: input.totalUnits * route.numeratorMinor,
    providerCostDenominator: route.denominator,
    minimumMarginBps: input.minimumMarginBps,
  });
}

function evaluateRoute(
  input: CommercialOfferMarginInput,
  route: CommercialOfferRouteRate,
): CommercialOfferRouteMargin {
  if (route.numeratorMinor <= 0n || route.denominator <= 0n) {
    throw new CommercialOfferMarginInputError(
      `Route ${route.rateId} has an invalid provider cost ratio.`,
    );
  }
  const costNumerator = input.totalUnits * route.numeratorMinor;
  // Round the customer-visible cost UP: understating provider cost is the expensive direction.
  const totalCostMinor =
    (costNumerator + route.denominator - 1n) / route.denominator;
  const marginMinor = input.totalPriceMinor - totalCostMinor;
  const marginBps = floorDiv(marginMinor * 10_000n, input.totalPriceMinor);
  return {
    route,
    totalCostMinor,
    marginMinor,
    marginBps: Number(marginBps),
    meetsFloor: satisfiesFloor(input, route),
  };
}

/** Negative when `left` is the cheaper route. Cross-multiplied so neither ratio is rounded. */
function compareCost(
  left: CommercialOfferRouteRate,
  right: CommercialOfferRouteRate,
): number {
  const leftScaled = left.numeratorMinor * right.denominator;
  const rightScaled = right.numeratorMinor * left.denominator;
  if (leftScaled === rightScaled) return 0;
  return leftScaled < rightScaled ? -1 : 1;
}

/**
 * Price every permitted route and report the range. The verdict is the WORST route's verdict, so an
 * offer that is only profitable on its cheapest destination cannot be published.
 *
 * Throws rather than returning a verdict when the inputs cannot support one — an empty route set
 * means no cost evidence exists, and the caller must fail closed instead of publishing on silence.
 */
export function evaluateCommercialOfferMargin(
  input: CommercialOfferMarginInput,
): CommercialOfferMarginEvaluation {
  if (input.totalUnits <= 0n) {
    throw new CommercialOfferMarginInputError(
      "totalUnits must be greater than zero.",
    );
  }
  if (input.totalPriceMinor <= 0n) {
    throw new CommercialOfferMarginInputError(
      "totalPriceMinor must be greater than zero.",
    );
  }
  if (
    !Number.isInteger(input.minimumMarginBps) ||
    input.minimumMarginBps < 0 ||
    input.minimumMarginBps > 10_000
  ) {
    throw new CommercialOfferMarginInputError(
      "minimumMarginBps must be an integer between 0 and 10000.",
    );
  }
  if (input.routes.length === 0) {
    throw new CommercialOfferMarginInputError(
      "At least one permitted route must carry provider-cost evidence.",
    );
  }

  const routes = input.routes.map((route) => evaluateRoute(input, route));
  const ordered = [...routes].sort((left, right) =>
    compareCost(left.route, right.route),
  );
  const bestCase = ordered[0];
  const worstCase = ordered[ordered.length - 1];
  if (!bestCase || !worstCase) {
    throw new CommercialOfferMarginInputError(
      "Route evaluation produced no rows.",
    );
  }
  return {
    routes,
    bestCase,
    worstCase,
    meetsFloor: worstCase.meetsFloor,
  };
}
