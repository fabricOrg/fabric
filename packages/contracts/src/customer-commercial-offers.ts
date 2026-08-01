import { z } from "zod";
import {
  commercialChannelCodeSchema,
  commercialOfferCodeSchema,
  commercialOfferEligibilitySchema,
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
  channel_code: commercialChannelCodeSchema,
  channel_name: z.string(),
  unit_code: commercialUnitCodeSchema,
  unit_label: z.string(),
  paid_units: positiveIntegerString,
  bonus_units: nonNegativeIntegerString,
  total_units: positiveIntegerString,
  total_price_minor: positiveIntegerString,
  currency,
  minimum_pack_count: z.number().int().positive(),
  maximum_pack_count: z.number().int().positive().nullable(),
  eligibility: commercialOfferEligibilitySchema,
  effective_to: z.string().datetime().nullable(),
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
  channel_code: commercialChannelCodeSchema,
  unit_code: commercialUnitCodeSchema,
  pack_count: z.number().int().positive(),
  quantity: positiveIntegerString,
  amount_minor: positiveIntegerString,
  currency,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type CommercialOfferPurchaseReceipt = z.infer<
  typeof commercialOfferPurchaseReceiptSchema
>;
