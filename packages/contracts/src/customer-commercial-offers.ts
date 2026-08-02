import { z } from "zod";
import { commercialOfferEligibilitySchema } from "./commercial-offer-eligibility.js";
import {
  commercialChannelCodeSchema,
  commercialOfferCodeSchema,
  commercialUnitCodeSchema,
  nonNegativeIntegerString,
  positiveIntegerString,
  purchaseCommercialOfferRequestSchema,
} from "./commercial-offers.js";
import { currency } from "./money.js";

/** Browser input: payer identity is supplied by the authenticated BFF session, never the client. */
export const purchaseCommercialOfferClientRequestSchema =
  purchaseCommercialOfferRequestSchema.omit({ email: true });
export type PurchaseCommercialOfferClientRequest = z.infer<
  typeof purchaseCommercialOfferClientRequestSchema
>;

/** Published terms safe for a customer to inspect. Cost and margin evidence remain staff-only. */
export const customerCommercialOfferSchema = z.object({
  offer_version_id: z.string().uuid(),
  offer_code: commercialOfferCodeSchema,
  name: z.string(),
  description: z.string(),
  items: z.array(
    z.object({
      channel_code: commercialChannelCodeSchema,
      channel_name: z.string(),
      unit_code: commercialUnitCodeSchema,
      unit_label: z.string(),
      paid_units: positiveIntegerString,
      bonus_units: nonNegativeIntegerString,
      total_units: positiveIntegerString,
      eligibility: commercialOfferEligibilitySchema,
    }),
  ),
  total_price_minor: positiveIntegerString,
  currency,
  credit_validity_days: z.number().int().positive().nullable(),
  minimum_pack_count: z.number().int().positive(),
  maximum_pack_count: z.number().int().positive().nullable(),
  effective_to: z.string().datetime().nullable(),
  /**
   * Packs of this PACKAGE the workspace has already paid for, across every version of it — a buyer
   * who bought v1 should still see that history on v2. Defaulted so an older api reads as "never
   * bought" rather than breaking the catalogue.
   */
  purchased_packs: z.number().int().nonnegative().default(0),
});
export type CustomerCommercialOffer = z.infer<
  typeof customerCommercialOfferSchema
>;

export const customerCommercialOfferCatalogSchema = z.object({
  catalog_name: z.string(),
  offers: z.array(customerCommercialOfferSchema),
});
export type CustomerCommercialOfferCatalog = z.infer<
  typeof customerCommercialOfferCatalogSchema
>;

export const commercialOfferPurchaseReceiptSchema = z.object({
  reference: z.string(),
  status: z.enum(["pending", "success", "failed"]),
  offer_version_id: z.string().uuid(),
  offer_name: z.string(),
  items: z.array(
    z.object({
      channel_code: commercialChannelCodeSchema,
      unit_code: commercialUnitCodeSchema,
      quantity: positiveIntegerString,
    }),
  ),
  pack_count: z.number().int().positive(),
  amount_minor: positiveIntegerString,
  currency,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type CommercialOfferPurchaseReceipt = z.infer<
  typeof commercialOfferPurchaseReceiptSchema
>;
