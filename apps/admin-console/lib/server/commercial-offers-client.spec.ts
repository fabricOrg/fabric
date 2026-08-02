import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cloneOfferVersion,
  publishOfferVersion,
} from "./commercial-offers-client";

const ACTOR = { email: "staff@example.com", staffId: crypto.randomUUID() };

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A published version DTO is parsed on the way back, so the stub has to be a plausible one. */
const VERSION_DTO = {
  id: crypto.randomUUID(),
  offer_id: crypto.randomUUID(),
  version: 2,
  status: "draft",
  currency: "GHS",
  items: [],
  paid_units: "0",
  bonus_units: "0",
  total_units: "0",
  total_price_minor: "300",
  credit_validity_days: null,
  minimum_pack_count: 1,
  maximum_pack_count: null,
  eligibility: {
    destination_countries: [],
    traffic_classes: [],
    provider_vendors: [],
    service_classes: [],
  },
  cost_snapshot: null,
  effective_from: new Date().toISOString(),
  effective_to: null,
  created_by: ACTOR.staffId,
  created_by_email: ACTOR.email,
  approved_by: null,
  approved_by_email: null,
  approved_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("commercial offer api client", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.API_BASE_URL = "http://api.test";
    process.env.BFF_INTERNAL_TOKEN = "token";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function headersOf(): Headers {
    return new Headers(fetchMock.mock.calls[0]?.[1]?.headers as HeadersInit);
  }

  it("sends no JSON content type on a bodyless action", async () => {
    // Fastify refuses an empty body under `content-type: application/json`
    // (FST_ERR_CTP_EMPTY_JSON_BODY), which is what broke Clone with an opaque 400.
    fetchMock.mockResolvedValue(jsonResponse(VERSION_DTO));

    await cloneOfferVersion(VERSION_DTO.id, ACTOR);

    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
    expect(headersOf().get("content-type")).toBeNull();
    expect(headersOf().get("x-actor-staff-id")).toBe(ACTOR.staffId);
  });

  it("still declares the content type when it does send a body", async () => {
    fetchMock.mockResolvedValue(jsonResponse(VERSION_DTO));

    await publishOfferVersion(VERSION_DTO.id, { reason: "ship it" }, ACTOR);

    expect(headersOf().get("content-type")).toBe("application/json");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain("ship it");
  });
});
