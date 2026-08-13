import { z } from "zod";
import { currency } from "./money.js";
import { pricingChannel, pricingTrafficClass } from "./price-books.js";

/**
 * Provider COST rates — what a vendor bills US, as against the sell prices in ./price-books.
 * Split out when price-books outgrew the file-length guard; the two are separate concerns that
 * happen to meet at the margin rule.
 */
const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => BigInt(value) > 0n, "Must be greater than zero.");

/**
 * The vendor slugs a cost rate may be keyed to, per channel.
 *
 * NOT free text, though it was. The send path looks a cost up by `provider_vendor = <adapter slug>`,
 * so a label like "testing whatsapp prcing" saved cleanly, displayed as an active cost, and could
 * never match a single send — WhatsApp failed with "no safe effective price is configured" while the
 * pricing screen showed a cost sitting right there. A value that must equal a slug cannot be a
 * text box.
 *
 * These are the slugs declared by the billable adapters in @app/integrations. Sandbox providers are
 * deliberately absent: sandbox traffic is metered against the daily allowance, never priced, so a
 * cost rate for one could never apply. Adding an adapter means adding it here.
 */
export const PROVIDER_VENDORS_BY_CHANNEL = {
  sms: ["arkesel-sms"],
  email: ["aws-ses-email"],
  whatsapp: ["meta-cloud"],
} as const satisfies Record<
  z.infer<typeof pricingChannel>,
  readonly [string, ...string[]]
>;

/** The plain shape. The DTO below derives from it, so the cross-field rule cannot live here. */
const providerCostRateShape = z.object({
  provider_vendor: z.string().trim().min(1).max(120),
  channel: pricingChannel,
  destination_country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .default(null),
  traffic_class: pricingTrafficClass.nullable().default(null),
  currency,
  numerator_minor: positiveIntegerString,
  denominator: positiveIntegerString,
  effective_from: z.string().datetime().optional(),
  source_reference: z.string().trim().min(1).max(500),
});

export const providerCostRateInputSchema = providerCostRateShape.superRefine(
  (rate, ctx) => {
    const allowed: readonly string[] =
      PROVIDER_VENDORS_BY_CHANNEL[rate.channel];
    if (allowed.includes(rate.provider_vendor)) return;
    ctx.addIssue({
      code: "custom",
      message: `${rate.provider_vendor} does not send ${rate.channel}. Costs must be keyed to the provider that bills us: ${allowed.join(", ")}.`,
      path: ["provider_vendor"],
    });
  },
);
export type ProviderCostRateInput = z.infer<typeof providerCostRateInputSchema>;

export const providerCostRateDtoSchema = providerCostRateShape
  .omit({ effective_from: true })
  .extend({
    id: z.string().uuid(),
    effective_from: z.string(),
    effective_to: z.string().nullable(),
  });
export type ProviderCostRateDto = z.infer<typeof providerCostRateDtoSchema>;

export const listProviderCostRatesResponseSchema = z.object({
  rates: z.array(providerCostRateDtoSchema),
});
