import {
  type CommercialOfferEligibility,
  unsupportedEligibilityDimensions,
} from "@app/contracts";
import type { CommercialOfferRouteRate } from "@app/domain";

/**
 * Turns an offer's eligibility into the set of routes a customer could actually spend the bundle on,
 * and prices each one from the provider-cost table (ADR-0012 §9).
 *
 * The hard part is not the arithmetic — it is refusing to guess. An UNRESTRICTED offer permits every
 * destination, so it needs a rate that covers every destination; if the cost table only knows Ghana,
 * this reports missing cost basis rather than pricing the offer as if Ghana were the world. Failing
 * closed here is the whole point: the alternative is a published bundle that loses money on a route
 * nobody priced.
 */

/** Channels that have a provider-cost representation today. A registry entry is not cost evidence. */
export const COSTABLE_CHANNELS = ["sms", "email"] as const;

/** The traffic classes `provider_cost_rates` can express (its CHECK constraint). */
export const COSTABLE_TRAFFIC_CLASSES = [
  "promotional",
  "transactional",
  "otp",
] as const;

/**
 * A permitted-route ceiling. Eligibility can express 250 countries × 50 traffic classes × 50 vendors,
 * and pricing every combination would be a slow endpoint answering a question staff did not mean to
 * ask. Beyond this, narrowing eligibility is the correct fix, not a bigger loop.
 */
const MAX_PERMITTED_ROUTES = 500;

export interface CostRateRow {
  readonly id: string;
  readonly providerVendor: string;
  readonly destinationCountry: string | null;
  readonly trafficClass: string | null;
  readonly numeratorMinor: bigint;
  readonly denominator: bigint;
  readonly sourceReference: string;
}

/** `null` on a dimension means "any value not named by a more specific rate". */
interface RouteKey {
  readonly providerVendor: string;
  readonly destinationCountry: string | null;
  readonly trafficClass: string | null;
}

export interface CostBasisFailure {
  readonly code:
    | "offer_channel_not_costable"
    | "offer_eligibility_unpriceable"
    | "offer_eligibility_unspendable"
    | "offer_eligibility_too_broad"
    | "offer_vendor_eligibility_required"
    | "offer_cost_basis_missing";
  readonly detail: string;
}

export type CostBasisResult =
  | { readonly ok: true; readonly routes: readonly CommercialOfferRouteRate[] }
  | { readonly ok: false; readonly failure: CostBasisFailure };

function describeRoute(route: RouteKey): string {
  return [
    route.providerVendor,
    route.destinationCountry ?? "any destination",
    route.trafficClass ?? "any traffic class",
  ].join(" / ");
}

/** Same specificity rule the pay-as-you-go quote uses: an explicit dimension beats a wildcard. */
function matchRate(
  route: RouteKey,
  rates: readonly CostRateRow[],
): CostRateRow | undefined {
  return rates
    .filter(
      (rate) =>
        rate.providerVendor === route.providerVendor &&
        matches(rate.destinationCountry, route.destinationCountry) &&
        matches(rate.trafficClass, route.trafficClass),
    )
    .sort((left, right) => specificity(right) - specificity(left))[0];
}

/**
 * A wildcard rate covers a named route. A rate NAMING a dimension cannot cover the wildcard route:
 * "any destination" must be priced by a rate that genuinely applies everywhere, or the offer is
 * unpriced for the destinations nobody listed.
 */
function matches(rateValue: string | null, routeValue: string | null): boolean {
  return rateValue === null || rateValue === routeValue;
}

function specificity(rate: CostRateRow): number {
  return (
    Number(rate.destinationCountry !== null) +
    Number(rate.trafficClass !== null)
  );
}

function distinct(values: readonly (string | null)[]): (string | null)[] {
  return [...new Set(values)];
}

/**
 * Which values a dimension can take. An explicit eligibility list is exactly that list. An EMPTY
 * list means unrestricted, which is the values the cost table names PLUS the wildcard route standing
 * for everything it does not — that wildcard is what forces an unrestricted offer to own a rate that
 * really covers everything.
 *
 * Only applicable to dimensions the cost table can leave NULL. `provider_vendor` is `NOT NULL`, so it
 * has no wildcard and is handled separately — see `offer_vendor_eligibility_required`.
 */
function permittedValues(
  configured: readonly string[],
  present: readonly (string | null)[],
): (string | null)[] {
  if (configured.length > 0) return [...configured];
  return distinct([...present, null]);
}

export function resolveOfferCostBasis(
  channelCode: string,
  eligibility: CommercialOfferEligibility,
  rates: readonly CostRateRow[],
): CostBasisResult {
  if (!COSTABLE_CHANNELS.includes(channelCode as "sms" | "email")) {
    return {
      ok: false,
      failure: {
        code: "offer_channel_not_costable",
        detail: `No provider-cost basis exists for the ${channelCode} channel yet, so its margin cannot be verified.`,
      },
    };
  }
  if (eligibility.service_classes.length > 0) {
    return {
      ok: false,
      failure: {
        code: "offer_eligibility_unpriceable",
        detail:
          "Provider costs are not recorded per service class, so a service-class restriction cannot be margin-checked.",
      },
    };
  }
  // Defence in depth behind the same check in the version contract: publication is the last gate
  // before an offer becomes sellable, and a restriction this channel's send path cannot supply
  // yields credits that are charged for but can never be drawn.
  const unspendable = unsupportedEligibilityDimensions(
    channelCode,
    eligibility,
  );
  if (unspendable.length > 0) {
    return {
      ok: false,
      failure: {
        code: "offer_eligibility_unspendable",
        detail: `A ${channelCode} send cannot be matched on ${unspendable.join(" or ").replace(/_/g, " ")}, so credits carrying that restriction could never be spent.`,
      },
    };
  }
  const unknownClass = eligibility.traffic_classes.find(
    (value) =>
      !COSTABLE_TRAFFIC_CLASSES.includes(
        value as (typeof COSTABLE_TRAFFIC_CLASSES)[number],
      ),
  );
  if (unknownClass) {
    return {
      ok: false,
      failure: {
        code: "offer_eligibility_unpriceable",
        detail: `Traffic class "${unknownClass}" has no provider-cost representation.`,
      },
    };
  }
  if (rates.length === 0) {
    return {
      ok: false,
      failure: {
        code: "offer_cost_basis_missing",
        detail:
          "No effective provider-cost rate exists for this channel and currency.",
      },
    };
  }
  /**
   * Vendors must be named explicitly, unlike destinations and traffic classes.
   *
   * Those two dimensions are NULLABLE in `provider_cost_rates`, so "unrestricted" can be proven safe by
   * demanding a wildcard rate that genuinely covers everything. `provider_vendor` is `NOT NULL` — a
   * wildcard vendor rate cannot exist — so an empty list could only ever be priced against the vendors
   * that happen to hold an EFFECTIVE rate at this instant. That silently narrows instead of failing
   * closed: an offer permitting a vendor whose rate is expired today (or who is onboarded tomorrow)
   * would publish having never been priced against it, and the stored snapshot would claim otherwise.
   */
  if (eligibility.provider_vendors.length === 0) {
    return {
      ok: false,
      failure: {
        code: "offer_vendor_eligibility_required",
        detail:
          "Name the providers this offer may be carried by. Provider costs are per vendor, so an unrestricted offer cannot be margin-checked against a vendor that has no rate yet.",
      },
    };
  }
  const vendors = [...eligibility.provider_vendors];
  const countries = permittedValues(
    eligibility.destination_countries,
    rates.map((rate) => rate.destinationCountry),
  );
  const trafficClasses = permittedValues(
    eligibility.traffic_classes,
    rates.map((rate) => rate.trafficClass),
  );

  const combinations =
    vendors.length * countries.length * trafficClasses.length;
  if (combinations > MAX_PERMITTED_ROUTES) {
    return {
      ok: false,
      failure: {
        code: "offer_eligibility_too_broad",
        detail: `This eligibility permits ${combinations} routes; narrow it to at most ${MAX_PERMITTED_ROUTES} so every route can be cost-checked.`,
      },
    };
  }

  const resolved: CommercialOfferRouteRate[] = [];
  for (const providerVendor of vendors) {
    for (const destinationCountry of countries) {
      for (const trafficClass of trafficClasses) {
        const route = { providerVendor, destinationCountry, trafficClass };
        const rate = matchRate(route, rates);
        if (!rate) {
          return {
            ok: false,
            failure: {
              code: "offer_cost_basis_missing",
              detail: `No provider-cost rate covers ${describeRoute(route)}.`,
            },
          };
        }
        resolved.push({
          rateId: rate.id,
          providerVendor,
          destinationCountry,
          trafficClass,
          sourceReference: rate.sourceReference,
          numeratorMinor: rate.numeratorMinor,
          denominator: rate.denominator,
        });
      }
    }
  }
  return { ok: true, routes: resolved };
}
