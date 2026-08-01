import { describe, expect, it } from "vitest";
import {
  commercialChannelCodeSchema,
  commercialOfferCostSnapshotSchema,
  createCommercialOfferRequestSchema,
  createCommercialOfferVersionRequestSchema,
  purchaseCommercialOfferRequestSchema,
} from "./commercial-offers.js";
import {
  assignOfferCatalogRequestSchema,
  previewCommercialOfferMarginRequestSchema,
  publishCommercialOfferVersionRequestSchema,
} from "./commercial-offers-admin.js";
import {
  commercialOfferPurchaseReceiptSchema,
  customerCommercialOfferCatalogSchema,
  purchaseCommercialOfferClientRequestSchema,
} from "./customer-commercial-offers.js";
import { tokenBalancesResponseSchema } from "./price-books.js";

const VERSION = {
  currency: "GHS",
  items: [
    {
      channel_code: "sms",
      unit_code: "segment",
      paid_units: "200",
      bonus_units: "0",
      eligibility: {
        destination_countries: ["GH"],
        traffic_classes: ["transactional"],
        provider_vendors: ["arkesel"],
        service_classes: [],
      },
    },
  ],
  total_price_minor: "300",
  credit_validity_days: null,
  minimum_pack_count: 1,
  maximum_pack_count: 10,
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

    expect(result.items[0]?.paid_units).toBe("200");
    expect(result.total_price_minor).toBe("300");
    expect("unit_price_minor" in result).toBe(false);
  });

  it("accepts a package containing multiple channel units", () => {
    const result = createCommercialOfferVersionRequestSchema.parse({
      ...VERSION,
      items: [
        VERSION.items[0],
        {
          channel_code: "email",
          unit_code: "message",
          paid_units: "20",
          bonus_units: "0",
          eligibility: {
            destination_countries: [],
            // No traffic class: the email send path cannot match one, so restricting by it would
            // sell credits that can never be drawn (see the unspendable-eligibility rule).
            traffic_classes: [],
            provider_vendors: ["aws-ses"],
            service_classes: [],
          },
        },
      ],
    });
    expect(result.items.map((item) => item.channel_code)).toEqual([
      "sms",
      "email",
    ]);
  });

  it("rejects duplicate channels inside one package", () => {
    const result = createCommercialOfferVersionRequestSchema.safeParse({
      ...VERSION,
      items: [VERSION.items[0], VERSION.items[0]],
    });
    expect(result.success).toBe(false);
  });

  it("keeps channel composition out of the stable offer identity", () => {
    const result = createCommercialOfferRequestSchema.parse({
      price_book_id: "00000000-0000-4000-8000-000000000001",
      code: "transactional-email-10k",
      name: "Transactional email 10k",
    });

    expect("channel_code" in result).toBe(false);
  });

  it("keeps token balances registry-backed for future channels", () => {
    const balances = tokenBalancesResponseSchema.parse({
      balances: [
        {
          channel: "voice",
          currency: "GHS",
          available: "120",
          expires_next_at: null,
        },
      ],
    });
    expect(balances.balances[0]?.channel).toBe("voice");
  });

  it("rejects bonus units until their accounting policy is enabled", () => {
    const result = createCommercialOfferVersionRequestSchema.safeParse({
      ...VERSION,
      items: [{ ...VERSION.items[0], bonus_units: "20" }],
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

  it("records both ends of the permitted-route cost range, and no invented average", () => {
    const snapshot = commercialOfferCostSnapshotSchema.parse({
      best_case_cost_minor: "180",
      worst_case_cost_minor: "240",
      best_case_margin_minor: "120",
      worst_case_margin_minor: "60",
      worst_case_margin_bps: 2_000,
      minimum_margin_bps: 2_000,
      minimum_margin_source: "catalog_version",
      route_count: 3,
      calculated_at: "2026-07-31T09:00:00.000Z",
      source_references: ["arkesel-2026-07"],
    });

    expect(snapshot.worst_case_cost_minor).toBe("240");
    expect("expected_cost_minor" in snapshot).toBe(false);
  });

  it("rejects an unknown cost-snapshot field rather than storing unvalidated evidence", () => {
    const result = commercialOfferCostSnapshotSchema.safeParse({
      best_case_cost_minor: "180",
      worst_case_cost_minor: "240",
      best_case_margin_minor: "120",
      worst_case_margin_minor: "60",
      worst_case_margin_bps: 2_000,
      minimum_margin_bps: 2_000,
      minimum_margin_source: "platform_default",
      route_count: 3,
      calculated_at: "2026-07-31T09:00:00.000Z",
      source_references: [],
      assumed_route: "GH/transactional",
    });

    expect(result.success).toBe(false);
  });

  it("requires a reason on the price-affecting publish", () => {
    expect(
      publishCommercialOfferVersionRequestSchema.safeParse({ reason: "" })
        .success,
    ).toBe(false);
    expect(
      publishCommercialOfferVersionRequestSchema.parse({
        reason: "Margin verified against the July Arkesel rate card.",
      }).reason,
    ).toContain("Margin verified");
  });

  it("previews margin for unsaved terms against a known offer", () => {
    const result = previewCommercialOfferMarginRequestSchema.parse({
      ...VERSION,
      offer_id: "00000000-0000-4000-8000-000000000003",
    });

    expect(result.offer_id).toBe("00000000-0000-4000-8000-000000000003");
    expect(result.items[0]?.channel_code).toBe("sms");
  });

  it("clears a workspace catalog assignment with an explicit null", () => {
    expect(
      assignOfferCatalogRequestSchema.parse({ offer_catalog_id: null })
        .offer_catalog_id,
    ).toBeNull();
    expect(assignOfferCatalogRequestSchema.safeParse({}).success).toBe(false);
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

  it("keeps payer identity out of the browser purchase contract", () => {
    const result = purchaseCommercialOfferClientRequestSchema.parse({
      offer_version_id: "00000000-0000-4000-8000-000000000002",
      pack_count: 2,
      email: "forged@example.com",
    });
    expect("email" in result).toBe(false);
  });

  it("exposes customer offer terms without staff cost or margin evidence", () => {
    const catalog = customerCommercialOfferCatalogSchema.parse({
      catalog_name: "Ghana prepaid",
      offers: [
        {
          offer_version_id: "00000000-0000-4000-8000-000000000002",
          offer_code: "sms-200",
          name: "200 segments",
          description: "Ghana transactional SMS",
          items: [
            {
              channel_code: "sms",
              channel_name: "SMS",
              unit_code: "segment",
              unit_label: "segments",
              paid_units: "200",
              bonus_units: "0",
              total_units: "200",
              eligibility: VERSION.items[0].eligibility,
            },
          ],
          total_price_minor: "300",
          currency: "GHS",
          credit_validity_days: null,
          minimum_pack_count: 1,
          maximum_pack_count: 10,
          effective_to: null,
          cost_snapshot: { worst_case_cost_minor: "240" },
        },
      ],
    });
    expect("cost_snapshot" in (catalog.offers[0] ?? {})).toBe(false);
  });

  it("parses the immutable purchase receipt status and exact quantities", () => {
    const receipt = commercialOfferPurchaseReceiptSchema.parse({
      reference: "token-ref",
      status: "pending",
      offer_version_id: "00000000-0000-4000-8000-000000000002",
      offer_name: "200 segments",
      items: [{ channel_code: "sms", unit_code: "segment", quantity: "400" }],
      pack_count: 2,
      amount_minor: "600",
      currency: "GHS",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    });
    expect(receipt.items[0]?.quantity).toBe("400");
  });
});
