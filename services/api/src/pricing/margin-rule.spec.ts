import { describe, expect, it } from "vitest";
import { marginSatisfied, minimumSellPriceMinor } from "./margin-rule.js";

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
    expect(marginSatisfied({ ...input, totalPriceMinor: floor })).toBe(true);
    expect(marginSatisfied({ ...input, totalPriceMinor: floor - 1n })).toBe(
      false,
    );
  });
});
