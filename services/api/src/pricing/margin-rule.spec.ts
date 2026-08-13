import { marginSatisfied, minimumSellPriceMinor } from "@app/domain";
import { describe, expect, it } from "vitest";

// The exact configuration that made WhatsApp unsendable in testing: the default book sold at GHS 0.12
// against a GHS 2.00 provider cost, and nothing refused it until a customer tried to send.
const THE_OUTAGE = {
  providerCostNumerator: 200n,
  providerCostDenominator: 1n,
  minimumMarginBps: 2_000,
};

describe("marginSatisfied", () => {
  it("rejects a price below the provider cost", () => {
    expect(marginSatisfied({ ...THE_OUTAGE, totalPriceMinor: 12n })).toBe(
      false,
    );
  });

  it("rejects a price above cost but inside the margin floor", () => {
    // 200 cost against 249 is a real margin, just not the 20% the book demands.
    expect(marginSatisfied({ ...THE_OUTAGE, totalPriceMinor: 249n })).toBe(
      false,
    );
  });

  it("accepts the exact boundary", () => {
    expect(marginSatisfied({ ...THE_OUTAGE, totalPriceMinor: 250n })).toBe(
      true,
    );
    expect(marginSatisfied({ ...THE_OUTAGE, totalPriceMinor: 300n })).toBe(
      true,
    );
  });

  // Rounding must not manufacture a rejection: 1 unit at 3/2 minor costs 1.5, and a price of 2 with a
  // zero floor is fine. Rounding the cost up to 2 first would make this fail.
  it("compares the rational cost, not the rounded one", () => {
    expect(
      marginSatisfied({
        totalPriceMinor: 2n,
        providerCostNumerator: 3n,
        providerCostDenominator: 2n,
        minimumMarginBps: 0,
      }),
    ).toBe(true);
  });
});

describe("minimumSellPriceMinor", () => {
  it("names a floor that itself passes", () => {
    const floor = minimumSellPriceMinor(THE_OUTAGE);
    expect(floor).toBe(250n);
    if (floor === null) throw new Error("expected a floor");
    expect(marginSatisfied({ ...THE_OUTAGE, totalPriceMinor: floor })).toBe(
      true,
    );
    expect(
      marginSatisfied({ ...THE_OUTAGE, totalPriceMinor: floor - 1n }),
    ).toBe(false);
  });

  // Rounds up even when the division is inexact, or the advice would be a price that still fails.
  it("rounds up rather than to the nearest", () => {
    const input = {
      providerCostNumerator: 100n,
      providerCostDenominator: 3n,
      minimumMarginBps: 2_000,
    };
    const floor = minimumSellPriceMinor(input);
    if (floor === null) throw new Error("expected a floor");
    expect(marginSatisfied({ ...input, totalPriceMinor: floor })).toBe(true);
    expect(marginSatisfied({ ...input, totalPriceMinor: floor - 1n })).toBe(
      false,
    );
  });

  // A 100% floor is accepted by the contract and the DB check, and no positive price can satisfy it.
  // Returning 0 here would have the caller print "charge at least GHS 0.00" — a price the
  // unit_price_minor > 0 check forbids, so the operator is told to do something impossible.
  it("has no answer at a 100% margin floor, and says so with null", () => {
    expect(
      minimumSellPriceMinor({
        providerCostNumerator: 200n,
        providerCostDenominator: 1n,
        minimumMarginBps: 10_000,
      }),
    ).toBeNull();
    expect(
      marginSatisfied({
        totalPriceMinor: 1_000_000n,
        providerCostNumerator: 200n,
        providerCostDenominator: 1n,
        minimumMarginBps: 10_000,
      }),
    ).toBe(false);
  });

  // The guard checks a single unit; the quote checks N. Both sides of the inequality scale linearly
  // in units, so the substitution is exact — pinned here because it is the assumption that lets a
  // config-time check stand in for a send-time one.
  it("is scale-invariant in units, which is why checking one unit is enough", () => {
    for (const units of [1n, 2n, 7n, 1_000n]) {
      expect(
        marginSatisfied({
          totalPriceMinor: units * 250n,
          providerCostNumerator: units * 200n,
          providerCostDenominator: 1n,
          minimumMarginBps: 2_000,
        }),
      ).toBe(true);
      expect(
        marginSatisfied({
          totalPriceMinor: units * 249n,
          providerCostNumerator: units * 200n,
          providerCostDenominator: 1n,
          minimumMarginBps: 2_000,
        }),
      ).toBe(false);
    }
  });
});
