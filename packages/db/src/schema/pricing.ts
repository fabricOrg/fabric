import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, timestamps } from "./_shared.js";
import { priceBooks } from "./price-books.js";

export interface PricingSnapshot {
  readonly priceBookVersionId: string;
  readonly sellRuleId: string;
  readonly providerCostRateId: string;
  readonly channel: "sms" | "email";
  readonly currency: string;
  readonly unitBasis: "segment" | "recipient";
  readonly units: string;
  readonly unitPriceMinor: string;
  readonly totalPriceMinor: string;
  readonly providerCostNumeratorMinor: string;
  readonly providerCostDenominator: string;
  readonly estimatedProviderCostMinor: string;
  readonly expectedMarginMinor: string;
  readonly destinationCountry?: string;
  readonly trafficClass?: "promotional" | "transactional" | "otp";
  readonly providerVendor: string;
}

export const priceBookVersions = pgTable(
  "price_book_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    minimumMarginBps: integer("minimum_margin_bps").notNull().default(2_000),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    sourceSnapshot: jsonb("source_snapshot").notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique("uniq_price_book_version").on(t.priceBookId, t.version),
    check(
      "price_book_versions_status_chk",
      sql`${t.status} in ('draft', 'published', 'retired')`,
    ),
    check(
      "price_book_versions_margin_chk",
      sql`${t.minimumMarginBps} between 0 and 10000`,
    ),
    check(
      "price_book_versions_window_chk",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    index("idx_price_book_versions_effective").on(
      t.priceBookId,
      t.status,
      t.effectiveFrom,
    ),
  ],
);

export const pricingSellRules = pgTable(
  "pricing_sell_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => priceBookVersions.id, { onDelete: "restrict" }),
    channel: text("channel").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    unitBasis: text("unit_basis").notNull(),
    unitPriceMinor: moneyMinor("unit_price_minor").notNull(),
    destinationCountry: char("destination_country", { length: 2 }),
    trafficClass: text("traffic_class"),
    providerVendor: text("provider_vendor"),
    ...timestamps,
  },
  (t) => [
    check(
      "pricing_sell_rules_channel_chk",
      sql`${t.channel} in ('sms', 'email')`,
    ),
    check(
      "pricing_sell_rules_basis_chk",
      sql`(${t.channel} = 'sms' and ${t.unitBasis} = 'segment')
        or (${t.channel} = 'email' and ${t.unitBasis} = 'recipient')`,
    ),
    check(
      "pricing_sell_rules_class_chk",
      sql`${t.trafficClass} is null or ${t.trafficClass} in ('promotional', 'transactional', 'otp')`,
    ),
    check("pricing_sell_rules_price_chk", sql`${t.unitPriceMinor} > 0`),
    unique("uniq_pricing_sell_rule")
      .on(
        t.versionId,
        t.channel,
        t.currency,
        t.destinationCountry,
        t.trafficClass,
        t.providerVendor,
      )
      .nullsNotDistinct(),
    index("idx_pricing_sell_rules_resolve").on(
      t.versionId,
      t.channel,
      t.currency,
      t.destinationCountry,
    ),
  ],
);

export const providerCostRates = pgTable(
  "provider_cost_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    providerVendor: text("provider_vendor").notNull(),
    channel: text("channel").notNull(),
    destinationCountry: char("destination_country", { length: 2 }),
    trafficClass: text("traffic_class"),
    currency: char("currency", { length: 3 }).notNull(),
    unitBasis: text("unit_basis").notNull(),
    numeratorMinor: bigint("numerator_minor", { mode: "bigint" }).notNull(),
    denominator: bigint("denominator", { mode: "bigint" }).notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    sourceReference: text("source_reference").notNull().default(""),
    ...timestamps,
  },
  (t) => [
    check(
      "provider_cost_rates_channel_chk",
      sql`${t.channel} in ('sms', 'email')`,
    ),
    check(
      "provider_cost_rates_basis_chk",
      sql`(${t.channel} = 'sms' and ${t.unitBasis} = 'segment')
        or (${t.channel} = 'email' and ${t.unitBasis} = 'recipient')`,
    ),
    check(
      "provider_cost_rates_class_chk",
      sql`${t.trafficClass} is null or ${t.trafficClass} in ('promotional', 'transactional', 'otp')`,
    ),
    check(
      "provider_cost_rates_ratio_chk",
      sql`${t.numeratorMinor} > 0 and ${t.denominator} > 0`,
    ),
    check(
      "provider_cost_rates_window_chk",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    index("idx_provider_cost_rates_resolve").on(
      t.providerVendor,
      t.channel,
      t.currency,
      t.destinationCountry,
      t.effectiveFrom,
    ),
    uniqueIndex("uniq_active_provider_cost_rate")
      .on(
        t.providerVendor,
        t.channel,
        t.currency,
        sql`coalesce(${t.destinationCountry}, '')`,
        sql`coalesce(${t.trafficClass}, '')`,
      )
      .where(sql`${t.effectiveTo} is null`),
  ],
);

export type PriceBookVersion = typeof priceBookVersions.$inferSelect;
export type PricingSellRule = typeof pricingSellRules.$inferSelect;
export type ProviderCostRate = typeof providerCostRates.$inferSelect;
