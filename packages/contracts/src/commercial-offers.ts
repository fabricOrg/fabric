import { z } from "zod";
import { currency } from "./money.js";

const code = z.string().regex(/^[a-z][a-z0-9_]{1,31}$/);
const offerCode = z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/);
const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => BigInt(value) > 0n, "Must be greater than zero.");
const nonNegativeIntegerString = z.string().regex(/^\d+$/);

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

const versionFields = z.object({
  currency,
  paid_units: positiveIntegerString,
  // The first release has no promotional units. Keeping the field explicit prevents a later
  // promotion feature from silently changing what "total units" meant on historical versions.
  bonus_units: nonNegativeIntegerString.refine(
    (value) => value === "0",
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
  versionFields.superRefine((version, ctx) => {
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

export const commercialOfferVersionDtoSchema = versionFields.extend({
  id: z.string().uuid(),
  offer_id: z.string().uuid(),
  version: z.number().int().positive(),
  status: commercialOfferStatusSchema,
  total_units: positiveIntegerString,
  cost_snapshot: z
    .object({
      estimated_cost_minor: nonNegativeIntegerString,
      worst_case_cost_minor: nonNegativeIntegerString,
      expected_margin_minor: z.string().regex(/^-?\d+$/),
      minimum_margin_bps: z.number().int().min(0).max(10_000),
      calculated_at: z.string().datetime(),
      source_references: z.array(z.string()),
    })
    .nullable(),
  created_by: z.string().uuid(),
  approved_by: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CommercialOfferVersionDto = z.infer<
  typeof commercialOfferVersionDtoSchema
>;

export const listCommercialOffersResponseSchema = z.object({
  offers: z.array(
    commercialOfferDtoSchema.extend({
      versions: z.array(commercialOfferVersionDtoSchema),
    }),
  ),
});

export const purchaseCommercialOfferRequestSchema = z.object({
  offer_version_id: z.string().uuid(),
  pack_count: z.number().int().positive().max(1_000_000),
  email: z.string().email(),
});
export type PurchaseCommercialOfferRequest = z.infer<
  typeof purchaseCommercialOfferRequestSchema
>;
