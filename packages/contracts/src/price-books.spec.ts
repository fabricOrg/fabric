import { describe, expect, it } from "vitest";
import { currency } from "./money.js";
import {
  priceBookRateDtoSchema,
  purchaseTokensRequestSchema,
  upsertPriceBookRequestSchema,
} from "./price-books.js";

/** Boundary validation for the price-book admin request — money invariants must fail at parse. */
describe("upsertPriceBookRequestSchema", () => {
  const base = {
    name: "Test",
    mode: "subscription" as const,
    description: "",
    is_default: false,
    is_public: false,
  };

  it("accepts a valid book", () => {
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      rates: [
        { channel: "sms", currency: "GHS", unit_price_minor: "3" },
        { channel: "email", currency: "GHS", unit_price_minor: "5" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a zero unit price (never a free send)", () => {
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      rates: [{ channel: "sms", currency: "GHS", unit_price_minor: "0" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a duplicate channel+currency pair", () => {
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      rates: [
        { channel: "sms", currency: "GHS", unit_price_minor: "3" },
        { channel: "sms", currency: "GHS", unit_price_minor: "4" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a lowercase currency (send path keys on uppercase)", () => {
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      rates: [{ channel: "sms", currency: "ghs", unit_price_minor: "3" }],
    });
    expect(result.success).toBe(false);
  });

  it("requires at least one rate", () => {
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      rates: [],
    });
    expect(result.success).toBe(false);
  });

  it("requires complete channel pairs for every published currency", () => {
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      is_public: true,
      rates: [{ channel: "sms", currency: "GHS", unit_price_minor: "3" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a complete published subscription book", () => {
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      is_public: true,
      rates: [
        { channel: "sms", currency: "GHS", unit_price_minor: "3" },
        { channel: "email", currency: "GHS", unit_price_minor: "5" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("does not allow token pricing to be published publicly", () => {
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      mode: "token",
      is_public: true,
      rates: [
        { channel: "sms", currency: "GHS", unit_price_minor: "3" },
        { channel: "email", currency: "GHS", unit_price_minor: "5" },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a currency the platform cannot settle", () => {
    // "XYZ" is three uppercase letters and used to pass. It has no entry in MINOR_PER_MAJOR, so
    // nothing downstream knows its scale and a send priced in it could never be billed.
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      rates: [{ channel: "sms", currency: "XYZ", unit_price_minor: "3" }],
    });
    expect(result.success).toBe(false);
  });

  it("refuses a lowercase currency rather than silently accepting it", () => {
    // The send path keys rates by exact currency, so a lowercase rate would never match.
    const result = upsertPriceBookRequestSchema.safeParse({
      ...base,
      rates: [{ channel: "sms", currency: "ghs", unit_price_minor: "3" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts every settleable currency", () => {
    for (const code of currency.options) {
      const result = upsertPriceBookRequestSchema.safeParse({
        ...base,
        rates: [{ channel: "sms", currency: code, unit_price_minor: "3" }],
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("priceBookRateDtoSchema (read path)", () => {
  it("still parses a legacy rate whose currency predates the enum", () => {
    // Deliberately looser than the write path. Tightening the READ would turn a row written before
    // the constraint into a 500 on the pricing page, hiding the very thing staff need to correct.
    const result = priceBookRateDtoSchema.safeParse({
      channel: "sms",
      currency: "XYZ",
      unit_price_minor: "3",
    });
    expect(result.success).toBe(true);
  });
});

describe("purchaseTokensRequestSchema", () => {
  it("refuses an unsettleable currency before any payment intent exists", () => {
    const result = purchaseTokensRequestSchema.safeParse({
      channel: "sms",
      quantity: 100,
      currency: "XYZ",
      email: "buyer@example.com",
    });
    expect(result.success).toBe(false);
  });
});
