import { describe, expect, it } from "vitest";
import {
  allocateCommercialOfferRecognition,
  recognizedThroughCommercialOffer,
} from "../src/commercial-offers.js";

describe("commercial offer revenue allocation", () => {
  it("allocates an indivisible 300 minor units across 200 units exactly", () => {
    const allocations: bigint[] = [];
    for (let consumed = 0n; consumed < 200n; consumed += 1n) {
      allocations.push(
        allocateCommercialOfferRecognition({
          totalPriceMinor: 300n,
          totalUnits: 200n,
          consumedBefore: consumed,
          quantity: 1n,
        }),
      );
    }

    expect(new Set(allocations)).toEqual(new Set([1n, 2n]));
    expect(allocations.reduce((sum, amount) => sum + amount, 0n)).toBe(300n);
  });

  it("produces the same exact total for arbitrary consumption partitions", () => {
    const quantities = [3n, 17n, 1n, 79n, 100n];
    let consumed = 0n;
    let recognized = 0n;

    for (const quantity of quantities) {
      recognized += allocateCommercialOfferRecognition({
        totalPriceMinor: 300n,
        totalUnits: 200n,
        consumedBefore: consumed,
        quantity,
      });
      consumed += quantity;
    }

    expect(consumed).toBe(200n);
    expect(recognized).toBe(300n);
  });

  it("is monotonic, bounded, and exact across many price/quantity pairs", () => {
    let monotonic = true;
    let bounded = true;
    let exact = true;
    let pairsChecked = 0;

    for (let price = 1n; price <= 50n; price += 1n) {
      for (let units = 1n; units <= 50n; units += 1n) {
        let previous = 0n;
        let allocated = 0n;
        for (let consumed = 1n; consumed <= units; consumed += 1n) {
          const through = recognizedThroughCommercialOffer(
            price,
            units,
            consumed,
          );
          monotonic &&= through >= previous;
          bounded &&= through <= price;
          allocated += through - previous;
          previous = through;
        }
        exact &&= allocated === price;
        pairsChecked += 1;
      }
    }

    expect({
      bounded,
      exact,
      monotonic,
      pairsChecked,
    }).toEqual({
      bounded: true,
      exact: true,
      monotonic: true,
      pairsChecked: 2_500,
    });
  });

  it("is channel-independent because it accepts only units and consideration", () => {
    const input = {
      totalPriceMinor: 1_200n,
      totalUnits: 10_000n,
      consumedBefore: 9_999n,
      quantity: 1n,
    };

    expect(allocateCommercialOfferRecognition(input)).toBe(1n);
  });

  it.each([
    {
      totalPriceMinor: 0n,
      totalUnits: 10n,
      consumedBefore: 0n,
      quantity: 1n,
    },
    {
      totalPriceMinor: 10n,
      totalUnits: 0n,
      consumedBefore: 0n,
      quantity: 1n,
    },
    {
      totalPriceMinor: 10n,
      totalUnits: 10n,
      consumedBefore: -1n,
      quantity: 1n,
    },
    {
      totalPriceMinor: 10n,
      totalUnits: 10n,
      consumedBefore: 10n,
      quantity: 1n,
    },
    {
      totalPriceMinor: 10n,
      totalUnits: 10n,
      consumedBefore: 0n,
      quantity: 0n,
    },
  ])("rejects an invalid allocation position", (input) => {
    expect(() => allocateCommercialOfferRecognition(input)).toThrow(RangeError);
  });
});
