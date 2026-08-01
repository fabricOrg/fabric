import { describe, expect, it } from "vitest";
import { allocateConsideration } from "./commercial-offer-margin.service.js";

describe("package consideration allocation", () => {
  it("allocates indivisible minor units deterministically and exactly", () => {
    expect(allocateConsideration(500n, [300n, 200n])).toEqual([300n, 200n]);
    expect(allocateConsideration(101n, [1n, 1n, 1n])).toEqual([34n, 34n, 33n]);
  });

  it("preserves positivity and the package total across varied inputs", () => {
    for (let total = 2n; total <= 200n; total += 1n) {
      for (let firstWeight = 1n; firstWeight <= 20n; firstWeight += 1n) {
        const result = allocateConsideration(total, [firstWeight, 21n]);
        expect(result.every((allocation) => allocation > 0n)).toBe(true);
        expect(result.reduce((sum, allocation) => sum + allocation, 0n)).toBe(
          total,
        );
      }
    }
  });

  it("refuses a price too small to give every item consideration", () => {
    expect(() => allocateConsideration(1n, [1n, 1n])).toThrow(
      /too small to allocate/i,
    );
  });
});
