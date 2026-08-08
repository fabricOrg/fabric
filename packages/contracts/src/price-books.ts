import { z } from "zod";
import { commercialChannelCodeSchema } from "./commercial-offers.js";
import { messageChannel } from "./message-definition-content.js";
import { currency } from "./money.js";

/**
 * Price-book DTOs (ADR-0010). A price book is a named set of per-channel, per-currency unit prices
 * that staff configure and each account is assigned. SMS is priced per segment, email flat per send.
 * Money is minor units as a decimal string (exact bigint on the wire — never a float), matching the
 * wallet/managed-message money shape.
 */

export const priceBookMode = z.enum(["subscription", "token"]);
export type PriceBookMode = z.infer<typeof priceBookMode>;
const pricingChannel = z.enum(["sms", "email", "whatsapp"]);
const pricingTrafficClass = z.enum([
  "promotional",
  "transactional",
  "otp",
  "marketing",
  "utility",
  "authentication",
]);

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

/**
 * A rate as READ BACK. Currency stays a loose 3-letter code on purpose: this schema also parses
 * rows already in the database, and those were written when any `[A-Z]{3}` string was accepted.
 * Tightening the read would turn a legacy row into a 500 on the pricing page instead of something
 * staff can see and correct. Writes are constrained separately — see `priceBookRateInputSchema`.
 */
export const priceBookRateDtoSchema = z.object({
  channel: messageChannel,
  // UPPERCASE — the send path keys rates by the exact currency, so a lowercase/typo rate would
  // never match and silently fail sends. Enforced uppercase closes that footgun at the boundary.
  currency: z.string().regex(/^[A-Z]{3}$/),
  unit_price_minor: unitPriceMinor,
});
export type PriceBookRateDto = z.infer<typeof priceBookRateDtoSchema>;

/**
 * A rate being WRITTEN. Constrained to the currencies the platform can actually settle: anything
 * else has no entry in `MINOR_PER_MAJOR`, so nothing downstream knows its scale, and a send priced
 * in it could never be billed. `[A-Z]{3}` accepted "XYZ" happily, which is a money-shaped hole
 * rather than a typo.
 */
export const priceBookRateInputSchema = z.object({
  channel: messageChannel,
  currency,
  unit_price_minor: unitPriceMinor,
});
export type PriceBookRateInput = z.infer<typeof priceBookRateInputSchema>;

export const priceBookDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mode: priceBookMode,
  description: z.string(),
  is_default: z.boolean(),
  is_public: z.boolean(),
  minimum_margin_bps: z.number().int().min(0).max(10_000),
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
 * wholesale — a book always carries its complete price table. Positivity and a settleable currency
 * are enforced by `priceBookRateInputSchema`; the rate set must have no duplicate (channel,
 * currency) pair (the DB `uniq_price_book_rate` index would otherwise 500 on insert).
 */
export const upsertPriceBookRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    mode: priceBookMode,
    description: z.string().trim().max(500).default(""),
    is_default: z.boolean().default(false),
    is_public: z.boolean().default(false),
    minimum_margin_bps: z.number().int().min(0).max(10_000).optional(),
    rates: z
      .array(priceBookRateInputSchema)
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

/**
 * Buy a fixed quantity of tokens for one channel (ADR-0010 Phase 2). The unit price is NOT accepted
 * from the client — it is resolved server-side from the default token price book and locked into the
 * granted lot, so a caller can neither pick their own price nor have it change under them later.
 */
export const purchaseTokensRequestSchema = z.object({
  channel: messageChannel,
  /** How many sends to buy. SMS spends one token per SEGMENT, email one per send. */
  quantity: z.number().int().positive().max(1_000_000),
  // Settleable currencies only — this one takes real money, so an unsupported code must be refused
  // before a payment intent exists rather than stranding a lot nothing can price.
  currency,
  email: z.string().email(),
});
export type PurchaseTokensRequest = z.infer<typeof purchaseTokensRequestSchema>;

export const purchaseTokensResponseSchema = z.object({
  /** Hosted-checkout URL; the grant lands only once the provider webhook confirms payment. */
  authorization_url: z.string(),
  reference: z.string(),
  /** Echoed so the buyer sees the exact price locked in, in minor units. */
  unit_price_minor: z.string(),
  amount_minor: z.string(),
});
export type PurchaseTokensResponse = z.infer<
  typeof purchaseTokensResponseSchema
>;

/** A tenant's spendable token counts, per channel and currency. */
export const tokenBalanceDtoSchema = z.object({
  channel: commercialChannelCodeSchema,
  currency: z.string(),
  available: z.string(),
  /**
   * When the soonest-expiring credits in this balance lapse, or null when none expire. Checkout
   * promises an expiry, so the balance has to be able to show it — otherwise credits can be
   * recognized as breakage without the customer ever having been told a date.
   */
  expires_next_at: z.string().datetime().nullable(),
  /**
   * The same balance broken down BY EXPIRY, soonest first, credits that never lapse last.
   *
   * `expires_next_at` alone reports the soonest date across the whole counter, which reads as "all
   * of it expires then" for a workspace holding a dated package and a permanent one at once. This
   * carries the real composition instead, and generalises: three packages with three dates produce
   * three groups. The groups sum to `available`.
   *
   * Empty means UNKNOWN, not "nothing expires" — an older API paired with a newer dashboard sends
   * no groups, and a consumer must render no expiry claim at all rather than inferring a permanent
   * balance from the absence of data.
   */
  expiry_groups: z
    .array(
      z.object({
        expires_at: z.string().datetime().nullable(),
        available: z.string(),
      }),
    )
    .default([]),
  /**
   * Lifetime totals for this counter: everything ever granted, and everything actually SPENT.
   *
   * `consumed_total` is NOT `granted_total - available` — expiry also removes credits, and
   * reporting forfeited breakage as "used" would tell a workspace it got value it never received.
   * Defaulted so an older API degrades to hiding the usage line rather than showing a wrong one.
   */
  granted_total: z.string().default("0"),
  consumed_total: z.string().default("0"),
});
export type TokenBalanceDto = z.infer<typeof tokenBalanceDtoSchema>;

export const tokenBalancesResponseSchema = z.object({
  balances: z.array(tokenBalanceDtoSchema),
});
export type TokenBalancesResponse = z.infer<typeof tokenBalancesResponseSchema>;

/** Assign (or clear → default) an account's price book (admin). */
export const assignPriceBookRequestSchema = z.object({
  price_book_id: z.string().uuid().nullable(),
  billing_currency: currency.optional(),
});
export type AssignPriceBookRequest = z.infer<
  typeof assignPriceBookRequestSchema
>;

const positiveIntegerString = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => BigInt(value) > 0n, "Must be greater than zero.");

export const providerCostRateInputSchema = z.object({
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
export type ProviderCostRateInput = z.infer<typeof providerCostRateInputSchema>;

export const providerCostRateDtoSchema = providerCostRateInputSchema
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

/**
 * Deliberately narrow public pricing snapshot. It contains no price-book identity, tenant assignment,
 * internal description, or staff metadata.
 */
export const publicPricingResponseSchema = z.object({
  rates: z.array(
    priceBookRateDtoSchema.extend({
      unit_basis: z.enum(["segment", "send", "message"]),
    }),
  ),
  effective_at: z.string(),
});
export type PublicPricingResponse = z.infer<typeof publicPricingResponseSchema>;
