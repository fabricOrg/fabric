import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, timestamps } from "./_shared.js";
import { staffUsers } from "./identity.js";
import { priceBooks } from "./price-books.js";

/**
 * Channel-specific restrictions stay typed at the boundary while remaining schema-extensible.
 * A future channel may add a new eligibility key without changing the offer or money columns.
 */
export interface CommercialOfferEligibility {
  readonly destinationCountries?: readonly string[];
  readonly trafficClasses?: readonly string[];
  readonly providerVendors?: readonly string[];
  readonly serviceClasses?: readonly string[];
}

export interface CommercialOfferCostSnapshot {
  readonly estimatedCostMinor: string;
  readonly worstCaseCostMinor: string;
  readonly expectedMarginMinor: string;
  readonly minimumMarginBps: number;
  readonly calculatedAt: string;
  readonly sourceReferences: readonly string[];
}

/**
 * A governed registry, not a hardcoded SMS/email enum. Adding a deliverable channel is a controlled
 * registry change; offers and their accounting continue to use the same quantity + consideration
 * model. A channel/unit pair is immutable once referenced by an offer.
 */
export const commercialOfferChannels = pgTable(
  "commercial_offer_channels",
  {
    code: text("code").notNull(),
    unitCode: text("unit_code").notNull(),
    displayName: text("display_name").notNull(),
    unitLabel: text("unit_label").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.code, t.unitCode],
      name: "commercial_offer_channels_pk",
    }),
    check(
      "commercial_offer_channels_code_chk",
      sql`${t.code} ~ '^[a-z][a-z0-9_]{1,31}$'`,
    ),
    check(
      "commercial_offer_channels_unit_chk",
      sql`${t.unitCode} ~ '^[a-z][a-z0-9_]{1,31}$'`,
    ),
  ],
);

/** Stable offer identity inside a price-book catalog. Purchases always target a VERSION, not this row. */
export const pricingOffers = pgTable(
  "pricing_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceBookId: uuid("price_book_id")
      .notNull()
      .references(() => priceBooks.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    channelCode: text("channel_code").notNull(),
    unitCode: text("unit_code").notNull(),
    ...timestamps,
  },
  (t) => [
    unique("uniq_pricing_offer_book_code").on(t.priceBookId, t.code),
    check(
      "pricing_offers_code_chk",
      sql`${t.code} ~ '^[a-z][a-z0-9_-]{1,63}$'`,
    ),
    foreignKey({
      columns: [t.channelCode, t.unitCode],
      foreignColumns: [
        commercialOfferChannels.code,
        commercialOfferChannels.unitCode,
      ],
      name: "pricing_offers_channel_unit_fk",
    }).onDelete("restrict"),
    index("idx_pricing_offers_catalog").on(
      t.priceBookId,
      t.channelCode,
      t.unitCode,
    ),
  ],
);

/**
 * An immutable commercial promise once published. The total consideration is authoritative; there
 * is deliberately no integer unit-price column because a fixed total may not divide evenly by the
 * promised units. Consumption allocates the total with cumulative integer arithmetic.
 */
export const pricingOfferVersions = pgTable(
  "pricing_offer_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => pricingOffers.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    currency: char("currency", { length: 3 }).notNull(),
    paidUnits: bigint("paid_units", { mode: "bigint" }).notNull(),
    bonusUnits: bigint("bonus_units", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    totalUnits: bigint("total_units", { mode: "bigint" }).notNull(),
    totalPriceMinor: moneyMinor("total_price_minor").notNull(),
    minimumPackCount: integer("minimum_pack_count").notNull().default(1),
    maximumPackCount: integer("maximum_pack_count"),
    eligibility: jsonb("eligibility")
      .$type<CommercialOfferEligibility>()
      .notNull()
      .default({}),
    costSnapshot: jsonb("cost_snapshot").$type<CommercialOfferCostSnapshot>(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => staffUsers.id, {
      onDelete: "restrict",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("uniq_pricing_offer_version").on(t.offerId, t.version),
    check("pricing_offer_versions_version_chk", sql`${t.version} > 0`),
    check(
      "pricing_offer_versions_status_chk",
      sql`${t.status} in ('draft', 'published', 'retired')`,
    ),
    check("pricing_offer_versions_paid_units_chk", sql`${t.paidUnits} > 0`),
    check("pricing_offer_versions_bonus_units_chk", sql`${t.bonusUnits} >= 0`),
    check(
      "pricing_offer_versions_total_units_chk",
      sql`${t.totalUnits} = ${t.paidUnits} + ${t.bonusUnits}`,
    ),
    check(
      "pricing_offer_versions_total_price_chk",
      sql`${t.totalPriceMinor} > 0`,
    ),
    check(
      "pricing_offer_versions_pack_range_chk",
      sql`${t.minimumPackCount} > 0 and
        (${t.maximumPackCount} is null or ${t.maximumPackCount} >= ${t.minimumPackCount})`,
    ),
    check(
      "pricing_offer_versions_window_chk",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
    check(
      "pricing_offer_versions_eligibility_chk",
      sql`jsonb_typeof(${t.eligibility}) = 'object'`,
    ),
    check(
      "pricing_offer_versions_approval_chk",
      sql`(${t.status} = 'draft' and ${t.approvedBy} is null and ${t.approvedAt} is null)
        or (${t.status} in ('published', 'retired') and ${t.approvedBy} is not null
          and ${t.approvedAt} is not null and ${t.approvedBy} <> ${t.createdBy})`,
    ),
    check(
      "pricing_offer_versions_cost_snapshot_chk",
      sql`${t.status} = 'draft' or ${t.costSnapshot} is not null`,
    ),
    index("idx_pricing_offer_versions_effective").on(
      t.offerId,
      t.status,
      t.currency,
      t.effectiveFrom,
    ),
  ],
);

export type CommercialOfferChannel =
  typeof commercialOfferChannels.$inferSelect;
export type PricingOffer = typeof pricingOffers.$inferSelect;
export type NewPricingOffer = typeof pricingOffers.$inferInsert;
export type PricingOfferVersion = typeof pricingOfferVersions.$inferSelect;
export type NewPricingOfferVersion = typeof pricingOfferVersions.$inferInsert;
