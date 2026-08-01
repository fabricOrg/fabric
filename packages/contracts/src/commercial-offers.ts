import { z } from "zod";
import { currency } from "./money.js";

const code = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const offerCode = z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/);
// Quantities and money travel as exact decimal-integer strings (bigint doesn't survive JSON).
// Exported for `commercial-offers-admin.ts` so staff authoring and customer purchase can never
// disagree about what counts as a valid quantity or amount.
// The 24-digit ceiling keeps a hostile or fat-fingered value from reaching a `bigint` column as a 500;
// it is still far above any real quantity or amount (10^24 minor units).
export const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .max(24, "Value is implausibly large.")
  .refine((value) => BigInt(value) > 0n, "Must be greater than zero.");
export const nonNegativeIntegerString = z
  .string()
  .regex(/^\d+$/)
  .max(24, "Value is implausibly large.");
export const signedIntegerString = z.string().regex(/^-?\d+$/);

/**
 * Commercial channels are registry-backed rather than an sms/email enum. The API still verifies
 * that the selected registry entry is active before publishing or purchasing an offer.
 */
export const commercialChannelCodeSchema = code;
export const commercialUnitCodeSchema = code;
export type CommercialChannelCode = z.infer<typeof commercialChannelCodeSchema>;
export type CommercialUnitCode = z.infer<typeof commercialUnitCodeSchema>;

export const commercialOfferStatusSchema = z.enum([
  "draft",
  "published",
  "retired",
]);
export type CommercialOfferStatus = z.infer<typeof commercialOfferStatusSchema>;

const eligibilityCode = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:-]+$/);

export const commercialOfferEligibilitySchema = z
  .object({
    destination_countries: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(250)
      .default([]),
    traffic_classes: z.array(eligibilityCode).max(50).default([]),
    provider_vendors: z.array(eligibilityCode).max(50).default([]),
    service_classes: z.array(eligibilityCode).max(50).default([]),
  })
  .strict();
export type CommercialOfferEligibility = z.infer<
  typeof commercialOfferEligibilitySchema
>;

export const createCommercialOfferRequestSchema = z.object({
  price_book_id: z.string().uuid(),
  code: offerCode,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  channel_code: commercialChannelCodeSchema,
  unit_code: commercialUnitCodeSchema,
});
export type CreateCommercialOfferRequest = z.infer<
  typeof createCommercialOfferRequestSchema
>;

/** The commercial terms of one version — shared by create, update, and the margin preview. */
export const commercialOfferVersionFieldsSchema = z.object({
  currency,
  paid_units: positiveIntegerString,
  // The first release has no promotional units. Keeping the field explicit prevents a later
  // promotion feature from silently changing what "total units" meant on historical versions.
  // The explicit `boolean` return matters: without it TypeScript infers a type predicate and the
  // field's type collapses to the literal `"0"`, which would make every DTO carrying a stored value
  // uncompilable the day bonus units ship.
  bonus_units: nonNegativeIntegerString.refine(
    (value): boolean => value === "0",
    "Bonus units are not enabled.",
  ),
  total_price_minor: positiveIntegerString,
  minimum_pack_count: z.number().int().positive().max(1_000_000).default(1),
  maximum_pack_count: z.number().int().positive().max(1_000_000).nullable(),
  eligibility: commercialOfferEligibilitySchema.default({
    destination_countries: [],
    traffic_classes: [],
    provider_vendors: [],
    service_classes: [],
  }),
  effective_from: z.string().datetime(),
  effective_to: z.string().datetime().nullable(),
});

export const createCommercialOfferVersionRequestSchema =
  commercialOfferVersionFieldsSchema.superRefine((version, ctx) => {
    if (
      version.maximum_pack_count !== null &&
      version.maximum_pack_count < version.minimum_pack_count
    ) {
      ctx.addIssue({
        code: "custom",
        message: "maximum_pack_count must be at least minimum_pack_count",
        path: ["maximum_pack_count"],
      });
    }
    if (
      version.effective_to !== null &&
      new Date(version.effective_to) <= new Date(version.effective_from)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "effective_to must be after effective_from",
        path: ["effective_to"],
      });
    }
  });
export type CreateCommercialOfferVersionRequest = z.infer<
  typeof createCommercialOfferVersionRequestSchema
>;

export const commercialOfferDtoSchema = createCommercialOfferRequestSchema
  .omit({ price_book_id: true })
  .extend({
    id: z.string().uuid(),
    price_book_id: z.string().uuid(),
    created_at: z.string(),
    updated_at: z.string(),
  });
export type CommercialOfferDto = z.infer<typeof commercialOfferDtoSchema>;

/**
 * Cost evidence captured when a version is published (ADR-0012 §9).
 *
 * Both ends of the permitted-route range are recorded because the margin GATE is the worst case —
 * a bundle is consumable on every route its eligibility allows, so the cheapest route says nothing
 * about whether the offer is safe. There is deliberately no single "expected" cost: the platform
 * cannot know which permitted route a customer will actually use, and averaging the routes would
 * present a number nobody can reproduce as though it were measured.
 */
export const commercialOfferCostSnapshotSchema = z
  .object({
    /** Cheapest permitted route — the optimistic bound, informational only. */
    best_case_cost_minor: nonNegativeIntegerString,
    /** Most expensive permitted route. This is what the margin floor is enforced against. */
    worst_case_cost_minor: nonNegativeIntegerString,
    best_case_margin_minor: signedIntegerString,
    worst_case_margin_minor: signedIntegerString,
    /** Worst-case margin as basis points of the total price; may be negative below cost. */
    worst_case_margin_bps: z.number().int(),
    minimum_margin_bps: z.number().int().min(0).max(10_000),
    /**
     * Where the floor came from. A token catalog created before price-book versioning has no
     * published version to read, and the platform default is recorded explicitly rather than
     * presented as the catalog's own approved figure.
     */
    minimum_margin_source: z.enum(["catalog_version", "platform_default"]),
    /** How many permitted (vendor × destination × traffic class) routes were priced. */
    route_count: z.number().int().positive(),
    calculated_at: z.string().datetime(),
    /** Provider-cost rate ids and their source references — the audit trail for the numbers above. */
    source_references: z.array(z.string()),
  })
  .strict();
export type CommercialOfferCostSnapshot = z.infer<
  typeof commercialOfferCostSnapshotSchema
>;

export const commercialOfferVersionDtoSchema =
  commercialOfferVersionFieldsSchema.extend({
    id: z.string().uuid(),
    offer_id: z.string().uuid(),
    version: z.number().int().positive(),
    status: commercialOfferStatusSchema,
    total_units: positiveIntegerString,
    cost_snapshot: commercialOfferCostSnapshotSchema.nullable(),
    created_by: z.string().uuid(),
    approved_by: z.string().uuid().nullable(),
    approved_at: z.string().nullable(),
    // Resolved for the admin history view. Null when the staff row was since removed; the id stays
    // authoritative, so a missing email degrades the display, never the approval record.
    created_by_email: z.string().nullable(),
    approved_by_email: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  });
export type CommercialOfferVersionDto = z.infer<
  typeof commercialOfferVersionDtoSchema
>;

/** A registered channel + natural unit. Only `is_active` entries may be published or purchased. */
export const commercialOfferChannelDtoSchema = z.object({
  code: commercialChannelCodeSchema,
  unit_code: commercialUnitCodeSchema,
  display_name: z.string(),
  unit_label: z.string(),
  is_active: z.boolean(),
});
export type CommercialOfferChannelDto = z.infer<
  typeof commercialOfferChannelDtoSchema
>;

export const commercialOfferWithVersionsSchema =
  commercialOfferDtoSchema.extend({
    catalog_name: z.string(),
    versions: z.array(commercialOfferVersionDtoSchema),
  });
export type CommercialOfferWithVersions = z.infer<
  typeof commercialOfferWithVersionsSchema
>;

export const listCommercialOffersResponseSchema = z.object({
  offers: z.array(commercialOfferWithVersionsSchema),
  channels: z.array(commercialOfferChannelDtoSchema),
});
export type ListCommercialOffersResponse = z.infer<
  typeof listCommercialOffersResponseSchema
>;

export const purchaseCommercialOfferRequestSchema = z.object({
  offer_version_id: z.string().uuid(),
  pack_count: z.number().int().positive().max(1_000_000),
  email: z.string().email(),
});
export type PurchaseCommercialOfferRequest = z.infer<
  typeof purchaseCommercialOfferRequestSchema
>;
