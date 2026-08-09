import { describe, expect, it } from "vitest";
import {
  type CostRateRow,
  resolveOfferCostBasis,
} from "./commercial-offer-cost.js";

function rate(overrides: Partial<CostRateRow> = {}): CostRateRow {
  return {
    id: "rate-gh",
    providerVendor: "arkesel",
    destinationCountry: "GH",
    trafficClass: "transactional",
    numeratorMinor: 1n,
    denominator: 1n,
    sourceReference: "arkesel-2026-07",
    ...overrides,
  };
}

const UNRESTRICTED = {
  destination_countries: [],
  traffic_classes: [],
  provider_vendors: [],
  service_classes: [],
};

describe("commercial offer cost basis", () => {
  it("prices each permitted route from the most specific matching rate", () => {
    const result = resolveOfferCostBasis(
      "sms",
      {
        ...UNRESTRICTED,
        destination_countries: ["GH", "NG"],
        traffic_classes: ["transactional"],
        provider_vendors: ["arkesel"],
      },
      [
        rate(),
        rate({ id: "rate-ng", destinationCountry: "NG", numeratorMinor: 3n }),
        // A wildcard rate exists, but the GH-specific one must win for GH.
        rate({ id: "rate-any", destinationCountry: null, numeratorMinor: 9n }),
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes).toHaveLength(2);
    expect(result.routes.map((route) => route.rateId)).toEqual([
      "rate-gh",
      "rate-ng",
    ]);
  });

  it("refuses an unrestricted offer when no rate covers unnamed destinations", () => {
    // This is the case worth protecting: eligibility says "anywhere", the table only knows Ghana. A
    // naive implementation prices the offer off the Ghana rate and publishes a bundle that loses money
    // on every other destination. The rate is wildcard on traffic class so DESTINATION is the only gap.
    const result = resolveOfferCostBasis(
      "sms",
      { ...UNRESTRICTED, provider_vendors: ["arkesel"] },
      [rate({ trafficClass: null })],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offer_cost_basis_missing");
    expect(result.failure.detail).toContain("any destination");
  });

  it("refuses an unrestricted traffic class when every rate names one", () => {
    // The same rule on the other dimension: "any class" needs a rate that really applies to any class.
    const result = resolveOfferCostBasis(
      "sms",
      {
        ...UNRESTRICTED,
        destination_countries: ["GH"],
        provider_vendors: ["arkesel"],
      },
      [rate({ trafficClass: "transactional" })],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.detail).toContain("any traffic class");
  });

  it("accepts unrestricted destinations and classes once a genuine wildcard rate exists", () => {
    const result = resolveOfferCostBasis(
      "sms",
      { ...UNRESTRICTED, provider_vendors: ["arkesel"] },
      [
        rate({
          id: "rate-any",
          destinationCountry: null,
          trafficClass: null,
          numeratorMinor: 2n,
        }),
      ],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.destinationCountry).toBeNull();
  });

  it("refuses an unrestricted vendor list instead of pricing only today's vendors", () => {
    // `provider_cost_rates.provider_vendor` is NOT NULL, so no wildcard-vendor rate can exist. Pricing
    // an empty list against "vendors that currently hold a rate" would silently narrow: a vendor whose
    // rate expired yesterday, or who is onboarded tomorrow, is permitted by the offer and never priced.
    const result = resolveOfferCostBasis(
      "sms",
      { ...UNRESTRICTED, destination_countries: ["GH"] },
      [rate({ trafficClass: null })],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offer_vendor_eligibility_required");
  });

  it("refuses a channel with no provider-cost representation", () => {
    const result = resolveOfferCostBasis("voice", UNRESTRICTED, [rate()]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offer_channel_not_costable");
  });

  it("refuses eligibility dimensions the cost table cannot express", () => {
    const withServiceClass = resolveOfferCostBasis(
      "sms",
      { ...UNRESTRICTED, service_classes: ["priority"] },
      [rate()],
    );
    expect(withServiceClass.ok).toBe(false);
    if (!withServiceClass.ok) {
      expect(withServiceClass.failure.code).toBe(
        "offer_eligibility_unpriceable",
      );
    }

    const withUnknownClass = resolveOfferCostBasis(
      "sms",
      { ...UNRESTRICTED, traffic_classes: ["marketing"] },
      [rate()],
    );
    expect(withUnknownClass.ok).toBe(false);
    if (!withUnknownClass.ok) {
      expect(withUnknownClass.failure.code).toBe(
        "offer_eligibility_unpriceable",
      );
    }
  });

  it("refuses when no effective rate exists for the channel and currency at all", () => {
    const result = resolveOfferCostBasis("sms", UNRESTRICTED, []);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offer_cost_basis_missing");
  });

  it("refuses eligibility too broad to cost-check rather than pricing a subset", () => {
    const countries = Array.from({ length: 26 }, (_, index) =>
      String.fromCharCode(65 + index).repeat(2),
    );
    const result = resolveOfferCostBasis(
      "sms",
      {
        ...UNRESTRICTED,
        destination_countries: countries,
        traffic_classes: ["transactional", "promotional", "otp"],
        provider_vendors: ["a", "b", "c", "d", "e", "f", "g"],
      },
      [rate()],
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offer_eligibility_too_broad");
  });

  it("costs a WhatsApp offer against Meta's template categories", () => {
    const result = resolveOfferCostBasis(
      "whatsapp",
      {
        ...UNRESTRICTED,
        destination_countries: ["GH"],
        traffic_classes: ["utility"],
        provider_vendors: ["meta-cloud"],
      },
      [
        rate({
          id: "rate-wa-gh",
          providerVendor: "meta-cloud",
          destinationCountry: "GH",
          trafficClass: "utility",
          numeratorMinor: 8n,
        }),
      ],
    );
    expect(result.ok).toBe(true);
  });

  it("refuses an SMS offer restricted to a WhatsApp-only class", () => {
    // The DB CHECK on `provider_cost_rates.traffic_class` is the UNION of every channel's vocabulary
    // — one column serves them all — so it cannot make this distinction. If this check went away, the
    // offer would publish and then match no hold forever: the customer is charged, every send bills
    // the wallet instead, and the stranded allocation is eventually recognised as breakage we keep.
    const result = resolveOfferCostBasis(
      "sms",
      { ...UNRESTRICTED, traffic_classes: ["utility"] },
      [rate({ trafficClass: "utility" })],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offer_eligibility_unpriceable");
    expect(result.failure.detail).toContain("utility");
  });

  it("refuses a WhatsApp offer restricted to an SMS-only class", () => {
    const result = resolveOfferCostBasis(
      "whatsapp",
      { ...UNRESTRICTED, traffic_classes: ["otp"] },
      [rate({ providerVendor: "meta-cloud", trafficClass: "otp" })],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offer_eligibility_unpriceable");
  });

  it("still refuses a channel with no provider-cost representation", () => {
    // Registering a channel is not cost evidence. `voice` is in neither map, so it fails here rather
    // than publishing an offer whose margin nobody can verify.
    const result = resolveOfferCostBasis("voice", UNRESTRICTED, [rate()]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("offer_channel_not_costable");
  });
});
