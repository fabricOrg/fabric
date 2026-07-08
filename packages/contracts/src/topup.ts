import { z } from "zod";
import { currency } from "./money.js";

/**
 * Wallet top-up (E4). Amount is EXACT minor units as a decimal string (never a float) — same money
 * discipline as the rest of the ledger. `email` is the payer (the provider requires it); the
 * dashboard BFF supplies it from the session so the client never sets it.
 */
export const initiateTopUpRequestSchema = z.object({
  amount_minor: z
    .string()
    .regex(/^[1-9]\d*$/, "Positive minor units required."),
  currency,
  email: z.string().trim().email().max(320),
});
export type InitiateTopUpRequest = z.infer<typeof initiateTopUpRequestSchema>;

export const initiateTopUpResponseSchema = z.object({
  authorization_url: z.string().url(),
  reference: z.string(),
});
export type InitiateTopUpResponse = z.infer<typeof initiateTopUpResponseSchema>;

/** The tenant's saved (reusable) card, captured from a prior card charge — powers auto top-up + the
 *  Payment-method card. `null` when none is on file (e.g. only ever paid by mobile money). */
export const paymentMethodResponseSchema = z.object({
  method: z
    .object({
      brand: z.string().nullable(),
      last4: z.string().nullable(),
      exp: z.string().nullable(),
    })
    .nullable(),
});
export type PaymentMethodResponse = z.infer<typeof paymentMethodResponseSchema>;

/** Auto top-up: when balance ≤ threshold, charge the saved card by top_up. Amounts exact minor
 *  units (threshold may be 0; top_up must be positive). */
export const autoTopupConfigSchema = z.object({
  enabled: z.boolean(),
  threshold_minor: z.string().regex(/^\d+$/, "Non-negative minor units."),
  top_up_minor: z.string().regex(/^[1-9]\d*$/, "Positive minor units."),
  currency,
});
export type AutoTopupConfig = z.infer<typeof autoTopupConfigSchema>;

export const updateAutoTopupRequestSchema = autoTopupConfigSchema;
export type UpdateAutoTopupRequest = AutoTopupConfig;

export const autoTopupResponseSchema = z.object({
  config: autoTopupConfigSchema.nullable(), // null = never configured
  has_card: z.boolean(), // a reusable card is on file (required to enable)
});
export type AutoTopupResponse = z.infer<typeof autoTopupResponseSchema>;
