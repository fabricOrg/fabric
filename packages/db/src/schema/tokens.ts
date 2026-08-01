import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, tenantIdCol, timestamps } from "./_shared.js";
import { pricingOfferVersionItems } from "./commercial-offer-items.js";
import { pricingOfferVersions } from "./commercial-offers.js";
import { accounts } from "./identity.js";
import type { TokenOfferItemSnapshot } from "./token-purchases.js";
import { ledgerTransactions } from "./wallet.js";

/**
 * A granted batch of tokens — the append-only record of "this tenant owns N sends on this channel at
 * this locked price". Never mutated to spend: consumption (2b) records holds against the counter and
 * leaves the lot's `quantity_total` intact, so the purchase history stays auditable.
 *
 * `expires_at` is NULL for the default non-expiring promise. A package may set explicit validity;
 * unused consideration then moves from deferred revenue to breakage when the lot expires.
 */
export const tokenLots = pgTable(
  "token_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // RESTRICT like the ledger: an account delete must never cascade-shred entitlement history.
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    channel: text("channel").notNull(),
    currency: text("currency").notNull(),
    offerVersionId: uuid("offer_version_id").references(
      () => pricingOfferVersions.id,
      { onDelete: "restrict" },
    ),
    offerVersionItemId: uuid("offer_version_item_id").references(
      () => pricingOfferVersionItems.id,
      { onDelete: "restrict" },
    ),
    compatibilitySnapshot: jsonb(
      "compatibility_snapshot",
    ).$type<TokenOfferItemSnapshot>(),
    /** The purchased count. A COUNT, not money. */
    quantityTotal: bigint("quantity_total", { mode: "bigint" }).notNull(),
    /** The lot's share of the package consideration, locked at purchase. */
    totalPriceMinorLocked: moneyMinor("total_price_minor_locked").notNull(),
    /** Cumulative allocation position, serialized under a row lock during committed consumption. */
    quantityConsumed: bigint("quantity_consumed", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    revenueRecognizedMinor: moneyMinor("revenue_recognized_minor")
      .notNull()
      .default(sql`0`),
    quantityExpired: bigint("quantity_expired", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    breakageRecognizedMinor: moneyMinor("breakage_recognized_minor")
      .notNull()
      .default(sql`0`),
    /** The originating `token_purchases.reference`; the grant-once key (unique per tenant below). */
    purchaseReference: text("purchase_reference").notNull(),
    /** The ledger txn that recognized the cash as deferred revenue — the reconciliation link. */
    purchaseTxnId: uuid("purchase_txn_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    expiryProcessedAt: timestamp("expiry_processed_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (t) => [
    // Grant-once at the DB: a replayed webhook cannot mint a second lot for the same purchase.
    unique("uniq_token_lot_purchase_channel").on(
      t.tenantId,
      t.purchaseReference,
      t.channel,
    ),
    unique("uniq_token_lot_tenant_id").on(t.tenantId, t.id),
    check("token_lots_quantity_chk", sql`${t.quantityTotal} > 0`),
    // Every lot descends from a published package item; there is no unpriced or ad-hoc lot.
    check(
      "token_lots_offer_provenance_chk",
      sql`${t.totalPriceMinorLocked} > 0
        and ${t.offerVersionId} is not null
        and ${t.offerVersionItemId} is not null
        and ${t.compatibilitySnapshot} is not null`,
    ),
    check(
      "token_lots_allocation_position_chk",
      sql`${t.quantityConsumed} >= 0
        and ${t.quantityExpired} >= 0
        and ${t.quantityConsumed} + ${t.quantityExpired} <= ${t.quantityTotal}
        and ${t.revenueRecognizedMinor} >= 0
        and ${t.breakageRecognizedMinor} >= 0
        and ${t.revenueRecognizedMinor} + ${t.breakageRecognizedMinor} <= ${t.totalPriceMinorLocked}
        and (${t.quantityConsumed} + ${t.quantityExpired} < ${t.quantityTotal}
          or ${t.revenueRecognizedMinor} + ${t.breakageRecognizedMinor} = ${t.totalPriceMinorLocked})`,
    ),
    check(
      "token_lots_expiry_state_chk",
      sql`(${t.expiresAt} is null and ${t.expiryProcessedAt} is null and ${t.quantityExpired} = 0 and ${t.breakageRecognizedMinor} = 0)
        or (${t.expiresAt} is not null and (${t.expiryProcessedAt} is null
          or (${t.expiryProcessedAt} >= ${t.expiresAt}
            and ${t.quantityConsumed} + ${t.quantityExpired} = ${t.quantityTotal})))`,
    ),
    index("idx_token_lots_tenant_channel").on(
      t.tenantId,
      t.channel,
      t.currency,
    ),
    // Expiry runs on the hot send path (holdTokens sweeps before reserving) and hourly across all
    // tenants, so the due-lot scan must not walk the whole table. Partial: processed lots are dead
    // weight here, and lots that never expire are the common case.
    index("idx_token_lots_due_for_expiry")
      .on(t.expiresAt)
      .where(
        sql`${t.expiryProcessedAt} is null and ${t.expiresAt} is not null`,
      ),
  ],
);

/**
 * The spendable balance projection, per (tenant, channel, currency) — the row the send path locks
 * FOR UPDATE to gate over-consumption, exactly as `reserve` locks the customer ledger account.
 *
 * GRANULARITY (review §6.3, signed off): per (channel, CURRENCY), not per channel alone. A lot carries
 * the currency its price was locked in, and revenue recognition follows that lot — so a per-channel-only
 * counter would leave both the FOR UPDATE target and the price to recognize ambiguous when a tenant
 * holds lots in more than one currency. The send already knows its currency, so this stays unambiguous.
 *
 * `available` is a CACHED PROJECTION of lots minus holds (same posture as `ledger_accounts.balance_minor`);
 * a CI invariant asserts it against the underlying rows. The `>= 0` CHECK is the hard floor — no amount
 * of application-layer breakage can drive an entitlement negative.
 */
export const tokenCounters = pgTable(
  "token_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    channel: text("channel").notNull(),
    currency: text("currency").notNull(),
    /** Sends still owned and spendable. A COUNT, not money. */
    available: bigint("available", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    ...timestamps,
  },
  (t) => [
    unique("uniq_token_counter").on(t.tenantId, t.channel, t.currency),
    // The no-negative-entitlement floor. Mirrors the wallet's overdraw rejection, enforced at the DB.
    check("token_counters_available_chk", sql`${t.available} >= 0`),
  ],
);

export type TokenLot = typeof tokenLots.$inferSelect;
export type NewTokenLot = typeof tokenLots.$inferInsert;
export type TokenCounter = typeof tokenCounters.$inferSelect;
export type NewTokenCounter = typeof tokenCounters.$inferInsert;
