import { describe, expect, it } from "vitest";
import {
  CommercialOfferMarginInputError,
  type CommercialOfferRouteRate,
  evaluateCommercialOfferMargin,
} from "../src/commercial-offer-margin.js";

function route(
  overrides: Partial<CommercialOfferRouteRate> = {},
): CommercialOfferRouteRate {
  return {
    rateId: "00000000-0000-4000-8000-000000000001",
    providerVendor: "arkesel",
    destinationCountry: "GH",
    trafficClass: "transactional",
    sourceReference: "arkesel-2026-07",
    // 1 pesewa per unit.
    numeratorMinor: 1n,
    denominator: 1n,
    ...overrides,
  };
}

// 200 segments sold for GHS 3.00 — the roadmap's indivisible example.
const OFFER = {
  totalUnits: 200n,
  totalPriceMinor: 300n,
  minimumMarginBps: 2_000,
} as const;

describe("commercial offer margin evaluation", () => {
  it("prices the full unit count on a route and reports the margin", () => {
    const result = evaluateCommercialOfferMargin({
      ...OFFER,
      routes: [route()],
    });

    expect(result.worstCase.totalCostMinor).toBe(200n);
    expect(result.worstCase.marginMinor).toBe(100n);
    // 100/300 = 33.33% → floored to 3333 bps, never rounded up into passing.
    expect(result.worstCase.marginBps).toBe(3_333);
    expect(result.meetsFloor).toBe(true);
  });

  it("decides on the WORST permitted route, not the cheapest one", () => {
    const result = evaluateCommercialOfferMargin({
      ...OFFER,
      routes: [
        route({ rateId: "r-cheap", destinationCountry: "GH" }),
        // NG costs 1.3 pesewas/unit → GHS 2.60 of a GHS 3.00 bundle, i.e. 13% margin.
        route({
          rateId: "r-dear",
          destinationCountry: "NG",
          numeratorMinor: 13n,
          denominator: 10n,
        }),
      ],
    });

    expect(result.bestCase.route.rateId).toBe("r-cheap");
    expect(result.worstCase.route.rateId).toBe("r-dear");
    expect(result.worstCase.totalCostMinor).toBe(260n);
    expect(result.bestCase.meetsFloor).toBe(true);
    expect(result.worstCase.meetsFloor).toBe(false);
    // One unsafe permitted route blocks publication even though another route is comfortable.
    expect(result.meetsFloor).toBe(false);
  });

  it("compares the rational cost, so a fractional rate is not failed by rounding", () => {
    // 3 units cost 1 minor unit → 200 units cost 66.67, which rounds UP to 67 for display.
    // Margin on the rounded figure is 233/300 = 77.6%; the pre-rounding comparison agrees, and the
    // point is that the ceil never manufactures a rejection.
    const result = evaluateCommercialOfferMargin({
      ...OFFER,
      routes: [route({ numeratorMinor: 1n, denominator: 3n })],
    });

    expect(result.worstCase.totalCostMinor).toBe(67n);
    expect(result.worstCase.meetsFloor).toBe(true);
  });

  it("accepts a route sitting exactly on the floor", () => {
    // 20% floor on GHS 3.00 allows GHS 2.40 of provider cost: 1.2 pesewas × 200 units.
    const result = evaluateCommercialOfferMargin({
      ...OFFER,
      routes: [route({ numeratorMinor: 12n, denominator: 10n })],
    });

    expect(result.worstCase.totalCostMinor).toBe(240n);
    expect(result.worstCase.marginBps).toBe(2_000);
    expect(result.meetsFloor).toBe(true);
  });

  it("floors a below-cost margin downward rather than flattering it", () => {
    // Cost GHS 4.00 against a GHS 3.00 price: -100/300 = -33.33% → -3334 bps, not -3333.
    const result = evaluateCommercialOfferMargin({
      ...OFFER,
      routes: [route({ numeratorMinor: 2n, denominator: 1n })],
    });

    expect(result.worstCase.marginMinor).toBe(-100n);
    expect(result.worstCase.marginBps).toBe(-3_334);
    expect(result.meetsFloor).toBe(false);
  });

  it("refuses to return a verdict with no cost evidence", () => {
    expect(() =>
      evaluateCommercialOfferMargin({ ...OFFER, routes: [] }),
    ).toThrow(CommercialOfferMarginInputError);
  });

  it("refuses a zero or negative provider cost ratio", () => {
    expect(() =>
      evaluateCommercialOfferMargin({
        ...OFFER,
        routes: [route({ numeratorMinor: 0n })],
      }),
    ).toThrow(CommercialOfferMarginInputError);
    expect(() =>
      evaluateCommercialOfferMargin({
        ...OFFER,
        routes: [route({ denominator: 0n })],
      }),
    ).toThrow(CommercialOfferMarginInputError);
  });

  it("refuses inputs that cannot support a verdict at all", () => {
    expect(() =>
      evaluateCommercialOfferMargin({
        ...OFFER,
        totalUnits: 0n,
        routes: [route()],
      }),
    ).toThrow(CommercialOfferMarginInputError);
    expect(() =>
      evaluateCommercialOfferMargin({
        ...OFFER,
        totalPriceMinor: 0n,
        routes: [route()],
      }),
    ).toThrow(CommercialOfferMarginInputError);
    expect(() =>
      evaluateCommercialOfferMargin({
        ...OFFER,
        minimumMarginBps: 10_001,
        routes: [route()],
      }),
    ).toThrow(CommercialOfferMarginInputError);
  });

  it("handles a bundle far beyond 2^53 units without precision loss", () => {
    const units = 9_007_199_254_740_993n; // 2^53 + 1
    const result = evaluateCommercialOfferMargin({
      totalUnits: units,
      totalPriceMinor: units * 10n,
      minimumMarginBps: 5_000,
      routes: [route({ numeratorMinor: 1n, denominator: 1n })],
    });

    expect(result.worstCase.totalCostMinor).toBe(units);
    expect(result.worstCase.marginMinor).toBe(units * 9n);
    expect(result.meetsFloor).toBe(true);
  });
});
