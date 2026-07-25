import { describe, expect, it } from "vitest";
import { upsertPriceBookRequestSchema } from "./price-books.js";

/** Boundary validation for the price-book admin request — money invariants must fail at parse. */
describe("upsertPriceBookRequestSchema", () => {
  const base = {
    name: "Test",
    mode: "subscription" as const,
    description: "",
    is_default: false,
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
});
