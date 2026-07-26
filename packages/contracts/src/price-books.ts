import { z } from "zod";
import { messageChannel } from "./message-definition-content.js";

/**
 * Price-book DTOs (ADR-0010). A price book is a named set of per-channel, per-currency unit prices
 * that staff configure and each account is assigned. SMS is priced per segment, email flat per send.
 * Money is minor units as a decimal string (exact bigint on the wire — never a float), matching the
 * wallet/managed-message money shape.
 */

export const priceBookMode = z.enum(["subscription", "token"]);
export type PriceBookMode = z.infer<typeof priceBookMode>;

/**
 * A STRICTLY POSITIVE integer amount of minor units (pesewas/kobo/cents) — a zero rate would price a
 * free send, so it is rejected here at the boundary (mirrored by the DB `price_book_rates_price_chk`).
 */
const unitPriceMinor = z
  .string()
  .regex(/^\d+$/)
  .refine((s) => BigInt(s) > 0n, {
    message: "unit_price_minor must be greater than 0",
  });

export const priceBookRateDtoSchema = z.object({
  channel: messageChannel,
  // ISO 4217, UPPERCASE — the send path keys rates by the exact currency, so a lowercase/typo rate
  // would never match and silently fail sends. Enforced uppercase closes that footgun at the boundary.
  currency: z.string().regex(/^[A-Z]{3}$/),
  unit_price_minor: unitPriceMinor,
});
export type PriceBookRateDto = z.infer<typeof priceBookRateDtoSchema>;

export const priceBookDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mode: priceBookMode,
  description: z.string(),
  is_default: z.boolean(),
  is_public: z.boolean(),
  rates: z.array(priceBookRateDtoSchema),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PriceBookDto = z.infer<typeof priceBookDtoSchema>;

export const listPriceBooksResponseSchema = z.object({
  books: z.array(priceBookDtoSchema),
});
export type ListPriceBooksResponse = z.infer<
  typeof listPriceBooksResponseSchema
>;

/**
 * Upsert a book's identity + full rate set (admin, Phase 1 slice 3). The rate list is REPLACED
 * wholesale — a book always carries its complete price table. Positivity + uppercase currency are
 * enforced by `priceBookRateDtoSchema`; the rate set must have no duplicate (channel, currency) pair
 * (the DB `uniq_price_book_rate` index would otherwise 500 on insert).
 */
export const upsertPriceBookRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mode: priceBookMode,
    description: z.string().trim().max(500).default(""),
    is_default: z.boolean().default(false),
    is_public: z.boolean().default(false),
    rates: z
      .array(priceBookRateDtoSchema)
      .min(1)
      .superRefine((rates, ctx) => {
        const seen = new Set<string>();
        rates.forEach((rate, index) => {
          const key = `${rate.channel}:${rate.currency}`;
          if (seen.has(key)) {
            ctx.addIssue({
              code: "custom",
              message: `duplicate rate for ${key}`,
              path: [index, "currency"],
            });
          }
          seen.add(key);
        });
      }),
  })
  .superRefine((book, ctx) => {
    if (!book.is_public) return;
    if (book.mode !== "subscription") {
      ctx.addIssue({
        code: "custom",
        message: "Only a subscription price book can be published.",
        path: ["is_public"],
      });
    }
    const channelsByCurrency = new Map<string, Set<string>>();
    for (const rate of book.rates) {
      const channels =
        channelsByCurrency.get(rate.currency) ?? new Set<string>();
      channels.add(rate.channel);
      channelsByCurrency.set(rate.currency, channels);
    }
    for (const [currency, channels] of channelsByCurrency) {
      if (channels.has("sms") && channels.has("email")) continue;
      ctx.addIssue({
        code: "custom",
        message: `Published currency ${currency} requires both SMS and email rates.`,
        path: ["rates"],
      });
    }
  });
export type UpsertPriceBookRequest = z.infer<
  typeof upsertPriceBookRequestSchema
>;

/** Assign (or clear → default) an account's price book (admin). */
export const assignPriceBookRequestSchema = z.object({
  price_book_id: z.string().uuid().nullable(),
});
export type AssignPriceBookRequest = z.infer<
  typeof assignPriceBookRequestSchema
>;

/**
 * Deliberately narrow public pricing snapshot. It contains no price-book identity, tenant assignment,
 * internal description, or staff metadata.
 */
export const publicPricingResponseSchema = z.object({
  rates: z.array(
    priceBookRateDtoSchema.extend({
      unit_basis: z.enum(["segment", "send"]),
    }),
  ),
  effective_at: z.string(),
});
export type PublicPricingResponse = z.infer<typeof publicPricingResponseSchema>;
