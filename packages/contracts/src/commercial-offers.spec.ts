import { describe, expect, it } from "vitest";
import {
  commercialChannelCodeSchema,
  createCommercialOfferRequestSchema,
  createCommercialOfferVersionRequestSchema,
  purchaseCommercialOfferRequestSchema,
} from "./commercial-offers.js";

const VERSION = {
  currency: "GHS",
  paid_units: "200",
  bonus_units: "0",
  total_price_minor: "300",
  minimum_pack_count: 1,
  maximum_pack_count: 10,
  eligibility: {
    destination_countries: ["GH"],
    traffic_classes: ["transactional"],
    provider_vendors: ["arkesel"],
    service_classes: [],
  },
  effective_from: "2026-08-01T00:00:00.000Z",
  effective_to: null,
} as const;

describe("commercial offer contracts", () => {
  it.each(["sms", "email", "voice", "whatsapp", "push_notification"])(
    "accepts the registry-backed channel code %s",
    (channel) => {
      expect(commercialChannelCodeSchema.parse(channel)).toBe(channel);
    },
  );

  it.each(["SMS", "voice-minute", "a", "contains space", "_sms"])(
    "rejects an invalid channel code %s",
    (channel) => {
      expect(commercialChannelCodeSchema.safeParse(channel).success).toBe(
        false,
      );
    },
  );

  it("accepts an indivisible fixed-total offer without inventing a unit price", () => {
    const result = createCommercialOfferVersionRequestSchema.parse(VERSION);

    expect(result.paid_units).toBe("200");
    expect(result.total_price_minor).toBe("300");
    expect("unit_price_minor" in result).toBe(false);
  });

  it("uses the same offer identity for a non-SMS channel and its natural unit", () => {
    const result = createCommercialOfferRequestSchema.parse({
      price_book_id: "00000000-0000-4000-8000-000000000001",
      code: "transactional-email-10k",
      name: "Transactional email 10k",
      channel_code: "email",
      unit_code: "recipient",
    });

    expect(result.channel_code).toBe("email");
    expect(result.unit_code).toBe("recipient");
  });

  it("rejects bonus units until their accounting policy is enabled", () => {
    const result = createCommercialOfferVersionRequestSchema.safeParse({
      ...VERSION,
      bonus_units: "20",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an inverted effective window", () => {
    const result = createCommercialOfferVersionRequestSchema.safeParse({
      ...VERSION,
      effective_to: "2026-07-31T23:59:59.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a maximum pack count below the minimum", () => {
    const result = createCommercialOfferVersionRequestSchema.safeParse({
      ...VERSION,
      minimum_pack_count: 5,
      maximum_pack_count: 4,
    });

    expect(result.success).toBe(false);
  });

  it("purchases a published version by id and pack count without a client price", () => {
    const result = purchaseCommercialOfferRequestSchema.parse({
      offer_version_id: "00000000-0000-4000-8000-000000000002",
      pack_count: 3,
      email: "buyer@example.com",
    });

    expect(result.pack_count).toBe(3);
    expect("amount_minor" in result).toBe(false);
  });
});
