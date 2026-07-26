import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPublicPricing } = vi.hoisted(() => ({
  getPublicPricing: vi.fn(),
}));

vi.mock("@/lib/server/public-pricing-client", () => ({
  PublicPricingApiError: class PublicPricingApiError extends Error {
    constructor(
      readonly status: number,
      readonly payload: unknown,
    ) {
      super("public pricing error");
    }
  },
  getPublicPricing,
}));

import { PublicPricingApiError } from "@/lib/server/public-pricing-client";
import { GET } from "./route";

describe("public pricing BFF", () => {
  beforeEach(() => {
    getPublicPricing.mockReset();
    getPublicPricing.mockResolvedValue({
      rates: [
        {
          channel: "sms",
          currency: "GHS",
          unit_price_minor: "3",
          unit_basis: "segment",
        },
        {
          channel: "email",
          currency: "GHS",
          unit_price_minor: "5",
          unit_basis: "send",
        },
      ],
      effective_at: "2026-07-26T00:00:00.000Z",
    });
  });

  it("returns only the published snapshot with public caching and CORS", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect(await response.json()).toEqual({
      rates: expect.any(Array),
      effective_at: "2026-07-26T00:00:00.000Z",
    });
  });

  it("does not reveal the internal error payload when publication is missing", async () => {
    getPublicPricing.mockRejectedValue(
      new PublicPricingApiError(404, {
        internal_book_id: "should-never-leak",
      }),
    );
    const response = await GET();
    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain(
      "should-never-leak",
    );
  });

  it("fails closed to a sanitized 503 on an unexpected dependency error", async () => {
    getPublicPricing.mockRejectedValue(new Error("BFF secret was rejected"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("BFF secret");
  });
});
