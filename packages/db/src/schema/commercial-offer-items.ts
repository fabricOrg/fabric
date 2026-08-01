import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, timestamps } from "./_shared.js";
import {
  type CommercialOfferEligibility,
  commercialOfferChannels,
  pricingOfferVersions,
} from "./commercial-offers.js";

/** One independently consumable channel allocation inside an immutable package version. */
export const pricingOfferVersionItems = pgTable(
  "pricing_offer_version_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    offerVersionId: uuid("offer_version_id")
      .notNull()
      .references(() => pricingOfferVersions.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    channelCode: text("channel_code").notNull(),
    unitCode: text("unit_code").notNull(),
    paidUnits: bigint("paid_units", { mode: "bigint" }).notNull(),
    bonusUnits: bigint("bonus_units", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    totalUnits: bigint("total_units", { mode: "bigint" }).notNull(),
    eligibility: jsonb("eligibility")
      .$type<CommercialOfferEligibility>()
      .notNull()
      .default({}),
    allocatedPriceMinor: moneyMinor("allocated_price_minor"),
    ...timestamps,
  },
  (t) => [
    unique("uniq_pricing_offer_version_item_position").on(
      t.offerVersionId,
      t.position,
    ),
    unique("uniq_pricing_offer_version_item_channel").on(
      t.offerVersionId,
      t.channelCode,
    ),
    foreignKey({
      columns: [t.channelCode, t.unitCode],
      foreignColumns: [
        commercialOfferChannels.code,
        commercialOfferChannels.unitCode,
      ],
      name: "pricing_offer_version_items_channel_unit_fk",
    }).onDelete("restrict"),
    check("pricing_offer_version_items_position_chk", sql`${t.position} >= 0`),
    check(
      "pricing_offer_version_items_paid_units_chk",
      sql`${t.paidUnits} > 0`,
    ),
    check(
      "pricing_offer_version_items_bonus_units_chk",
      sql`${t.bonusUnits} >= 0`,
    ),
    check(
      "pricing_offer_version_items_total_units_chk",
      sql`${t.totalUnits} = ${t.paidUnits} + ${t.bonusUnits}`,
    ),
    check(
      "pricing_offer_version_items_eligibility_chk",
      sql`jsonb_typeof(${t.eligibility}) = 'object'`,
    ),
    check(
      "pricing_offer_version_items_allocation_chk",
      sql`${t.allocatedPriceMinor} is null or ${t.allocatedPriceMinor} > 0`,
    ),
    index("idx_pricing_offer_version_items_channel").on(
      t.offerVersionId,
      t.channelCode,
      t.unitCode,
    ),
  ],
);

export type PricingOfferVersionItem =
  typeof pricingOfferVersionItems.$inferSelect;
export type NewPricingOfferVersionItem =
  typeof pricingOfferVersionItems.$inferInsert;
