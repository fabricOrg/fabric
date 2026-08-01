// Staff-only commercial-offer authoring: draft edits, the two-actor publish, retirement, the
// publish-time margin verdict, and workspace catalog assignment. Kept apart from
// `commercial-offers.ts` (identity, terms, purchase) because nothing customer-facing may import it.

import { z } from "zod";
import {
  type CreateCommercialOfferVersionRequest,
  commercialOfferCostSnapshotSchema,
  commercialOfferVersionFieldsSchema,
  createCommercialOfferVersionRequestSchema,
  nonNegativeIntegerString,
  positiveIntegerString,
  signedIntegerString,
} from "./commercial-offers.js";
import { currency } from "./money.js";

/** A draft may be edited freely; a published version is cloned instead (ADR-0012 §6). */
export const updateCommercialOfferVersionRequestSchema =
  createCommercialOfferVersionRequestSchema;
export type UpdateCommercialOfferVersionRequest =
  CreateCommercialOfferVersionRequest;

/**
 * Publishing is the price-affecting act, so it carries the checker's reason into the audit log.
 * The API refuses when the actor is the version's author — separation of duties is also a database
 * CHECK, so a bypass fails at write time rather than shipping an unapproved price.
 */
export const publishCommercialOfferVersionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type PublishCommercialOfferVersionRequest = z.infer<
  typeof publishCommercialOfferVersionRequestSchema
>;

export const retireCommercialOfferVersionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RetireCommercialOfferVersionRequest = z.infer<
  typeof retireCommercialOfferVersionRequestSchema
>;

/**
 * Preview the margin verdict for terms that may not be saved yet, so the authoring form can show
 * the gate's answer before a draft exists. The channel comes from the offer, never the client.
 */
export const previewCommercialOfferMarginRequestSchema =
  commercialOfferVersionFieldsSchema.extend({
    offer_id: z.string().uuid(),
  });
export type PreviewCommercialOfferMarginRequest = z.infer<
  typeof previewCommercialOfferMarginRequestSchema
>;

/** One priced route the offer's eligibility permits. Present in every margin evaluation. */
export const commercialOfferRouteCostSchema = z.object({
  item_index: z.number().int().nonnegative(),
  channel_code: z.string(),
  unit_code: z.string(),
  provider_vendor: z.string(),
  destination_country: z.string().nullable(),
  traffic_class: z.string().nullable(),
  provider_cost_rate_id: z.string().uuid(),
  source_reference: z.string(),
  /** Total provider cost for the offer's full unit count on this route, rounded up. */
  total_cost_minor: nonNegativeIntegerString,
  margin_minor: signedIntegerString,
  margin_bps: z.number().int(),
  meets_floor: z.boolean(),
});
export type CommercialOfferRouteCost = z.infer<
  typeof commercialOfferRouteCostSchema
>;

export const commercialOfferMarginItemSchema = z.object({
  item_index: z.number().int().nonnegative(),
  channel_code: z.string(),
  unit_code: z.string(),
  total_units: positiveIntegerString,
  best_case_cost_minor: nonNegativeIntegerString,
  worst_case_cost_minor: nonNegativeIntegerString,
  allocated_price_minor: positiveIntegerString,
});

/**
 * Publish-time margin evidence, also served as an un-saved preview so staff see the verdict BEFORE
 * committing a price. A preview that cannot be calculated fails closed rather than reporting an
 * optimistic pass. `blocked_reason` is a stable code so a caller CAN branch on it; today the admin UI
 * renders `blocked_detail` and leaves the branching to whoever needs it.
 */
export const commercialOfferMarginPreviewSchema = z.object({
  currency,
  total_price_minor: positiveIntegerString,
  /** Informational only — a fixed total need not divide evenly by its units. */
  items: z.array(commercialOfferMarginItemSchema),
  cost_snapshot: commercialOfferCostSnapshotSchema.nullable(),
  routes: z.array(commercialOfferRouteCostSchema),
  publishable: z.boolean(),
  blocked_reason: z.string().nullable(),
  blocked_detail: z.string().nullable(),
});
export type CommercialOfferMarginPreview = z.infer<
  typeof commercialOfferMarginPreviewSchema
>;

/**
 * Assign (or clear → the default token catalog) a workspace's prepaid offer catalog. Separate from
 * `price_book_id`, which selects the pay-as-you-go rate book: a negotiated bundle catalog and a
 * negotiated per-unit rate plan are independent commercial decisions (ADR-0012 §8).
 */
export const assignOfferCatalogRequestSchema = z.object({
  offer_catalog_id: z.string().uuid().nullable(),
  /** Why this workspace was moved off the default catalog — negotiated pricing needs a paper trail. */
  reason: z.string().trim().max(500).default(""),
});
export type AssignOfferCatalogRequest = z.infer<
  typeof assignOfferCatalogRequestSchema
>;
