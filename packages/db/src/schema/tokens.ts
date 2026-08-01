import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, tenantIdCol, timestamps } from "./_shared.js";
import { pricingOfferVersions } from "./commercial-offers.js";
import { accounts } from "./identity.js";
import type { TokenOfferSnapshot } from "./token-purchases.js";
import { ledgerTransactions } from "./wallet.js";

/**
 * A granted batch of tokens — the append-only record of "this tenant owns N sends on this channel at
 * this locked price". Never mutated to spend: consumption (2b) records holds against the counter and
 * leaves the lot's `quantity_total` intact, so the purchase history stays auditable.
 *
 * `expires_at` is reserved and NULL by default: ADR-0010 #7 sets NO token expiry (elastic supply gives
 * expiry no cost basis), but count-based lots make adding one later a pure pricing lever.
 */
export const tokenLots = pgTable(
  "token_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // RESTRICT like the ledger: an account delete must never cascade-shred entitlement history.
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    channel: text("channel").notNull(), // sms | email
    currency: text("currency").notNull(),
    pricingModel: text("pricing_model").notNull().default("unit"),
    offerVersionId: uuid("offer_version_id").references(
      () => pricingOfferVersions.id,
      { onDelete: "restrict" },
    ),
    compatibilitySnapshot: jsonb(
      "compatibility_snapshot",
    ).$type<TokenOfferSnapshot>(),
    /** The purchased count. A COUNT, not money. */
    quantityTotal: bigint("quantity_total", { mode: "bigint" }).notNull(),
    /** Price locked at purchase — later price-book edits never touch tokens already bought. */
    unitPriceMinorLocked: moneyMinor("unit_price_minor_locked"),
    /** Authoritative fixed consideration for the whole lot; null only for legacy unit-priced lots. */
    totalPriceMinorLocked: moneyMinor("total_price_minor_locked"),
    /** Cumulative allocation position, serialized under a row lock during committed consumption. */
    quantityConsumed: bigint("quantity_consumed", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    revenueRecognizedMinor: moneyMinor("revenue_recognized_minor")
      .notNull()
      .default(sql`0`),
    /** The originating `token_purchases.reference`; the grant-once key (unique per tenant below). */
    purchaseReference: text("purchase_reference").notNull(),
    /** The ledger txn that recognized the cash as deferred revenue — the reconciliation link. */
    purchaseTxnId: uuid("purchase_txn_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Grant-once at the DB: a replayed webhook cannot mint a second lot for the same purchase.
    unique("uniq_token_lot_purchase").on(t.tenantId, t.purchaseReference),
    unique("uniq_token_lot_tenant_id").on(t.tenantId, t.id),
    check("token_lots_channel_chk", sql`${t.channel} in ('sms', 'email')`),
    check("token_lots_quantity_chk", sql`${t.quantityTotal} > 0`),
    check(
      "token_lots_pricing_model_chk",
      sql`(${t.pricingModel} = 'unit'
          and ${t.unitPriceMinorLocked} > 0
          and ${t.totalPriceMinorLocked} is null
          and ${t.offerVersionId} is null
          and ${t.compatibilitySnapshot} is null)
        or (${t.pricingModel} = 'fixed_bundle'
          and ${t.unitPriceMinorLocked} is null
          and ${t.totalPriceMinorLocked} > 0
          and ${t.offerVersionId} is not null
          and ${t.compatibilitySnapshot} is not null)`,
    ),
    check(
      "token_lots_allocation_position_chk",
      sql`${t.quantityConsumed} >= 0
        and ${t.quantityConsumed} <= ${t.quantityTotal}
        and ${t.revenueRecognizedMinor} >= 0
        and ((${t.pricingModel} = 'unit'
            and ${t.revenueRecognizedMinor} = ${t.quantityConsumed} * ${t.unitPriceMinorLocked})
          or (${t.pricingModel} = 'fixed_bundle'
            and ${t.revenueRecognizedMinor} <= ${t.totalPriceMinorLocked}
            and (${t.quantityConsumed} < ${t.quantityTotal}
              or ${t.revenueRecognizedMinor} = ${t.totalPriceMinorLocked})))`,
    ),
    index("idx_token_lots_tenant_channel").on(
      t.tenantId,
      t.channel,
      t.currency,
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
    channel: text("channel").notNull(), // sms | email
    currency: text("currency").notNull(),
    /** Sends still owned and spendable. A COUNT, not money. */
    available: bigint("available", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    ...timestamps,
  },
  (t) => [
    unique("uniq_token_counter").on(t.tenantId, t.channel, t.currency),
    check("token_counters_channel_chk", sql`${t.channel} in ('sms', 'email')`),
    // The no-negative-entitlement floor. Mirrors the wallet's overdraw rejection, enforced at the DB.
    check("token_counters_available_chk", sql`${t.available} >= 0`),
  ],
);

/**
 * A send's in-flight claim on tokens — the count-space mirror of a wallet `reserve` (slice 2b).
 * Lifecycle: `pending` on accept → `committed` on delivery (2c recognizes revenue at this lot's
 * locked price) → or `returned` on failure/expiry, which puts the quantity back on the counter.
 *
 * ONE HOLD ROW PER LOT. A claim that spans lots (the counter aggregates them) is split so every row
 * carries exactly one locked price, which is what makes recognition unambiguous. Lots are drawn
 * expiry-soonest then oldest — plain FIFO today, since no expiry exists yet (ADR-0010 #7).
 *
 * QUANTITY IS NOT ALWAYS 1: SMS is priced per SEGMENT (ADR-0010 §5), so a 3-segment message holds 3
 * tokens. Email is flat per send, so 1.
 */
export const tokenHolds = pgTable(
  "token_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    // RESTRICT: a lot is history for anything held against it; it must never vanish underneath.
    lotId: uuid("lot_id").notNull(),
    channel: text("channel").notNull(), // sms | email
    currency: text("currency").notNull(),
    /** Tokens claimed from THIS lot. A COUNT, not money. */
    quantity: bigint("quantity", { mode: "bigint" }).notNull(),
    /** The message/delivery this claim is for — the commit/return key, as `reference_id` is for money. */
    referenceId: uuid("reference_id").notNull(),
    /** Deterministic, e.g. `hold:{deliveryId}:{lotId}`. Dedupes a retried accept at the DB. */
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"), // pending | committed | returned
    ...timestamps,
  },
  (t) => [
    // Exactly-once per (send, lot): a retried accept cannot claim the same tokens twice.
    unique("uniq_token_hold_idempotency").on(t.tenantId, t.idempotencyKey),
    unique("uniq_token_hold_tenant_id").on(t.tenantId, t.id),
    foreignKey({
      columns: [t.tenantId, t.lotId],
      foreignColumns: [tokenLots.tenantId, tokenLots.id],
      name: "token_holds_tenant_lot_fk",
    }).onDelete("restrict"),
    check(
      "token_holds_status_chk",
      sql`${t.status} in ('pending', 'committed', 'returned')`,
    ),
    check("token_holds_channel_chk", sql`${t.channel} in ('sms', 'email')`),
    check("token_holds_quantity_chk", sql`${t.quantity} > 0`),
    // Find every hold for a send (commit/return) and sweep stuck pendings.
    index("idx_token_holds_reference").on(t.tenantId, t.referenceId),
    index("idx_token_holds_pending").on(t.tenantId, t.status, t.createdAt),
  ],
);

/**
 * Append-only bridge from one committed lot hold to the exact revenue it recognized. The lot stores
 * the current cumulative position for serialization; these rows make every increment independently
 * reconcilable to its entitlement, message, and double-entry ledger transaction.
 */
export const tokenRecognitionAllocations = pgTable(
  "token_recognition_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    lotId: uuid("lot_id").notNull(),
    holdId: uuid("hold_id").notNull(),
    referenceId: uuid("reference_id").notNull(),
    quantity: bigint("quantity", { mode: "bigint" }).notNull(),
    consumedBefore: bigint("consumed_before", { mode: "bigint" }).notNull(),
    consumedAfter: bigint("consumed_after", { mode: "bigint" }).notNull(),
    recognizedBeforeMinor: moneyMinor("recognized_before_minor").notNull(),
    recognizedAfterMinor: moneyMinor("recognized_after_minor").notNull(),
    recognitionMinor: moneyMinor("recognition_minor").notNull(),
    ledgerTxnId: uuid("ledger_txn_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("uniq_token_recognition_hold").on(t.holdId),
    unique("uniq_token_recognition_ledger_txn").on(t.ledgerTxnId),
    foreignKey({
      columns: [t.tenantId, t.lotId],
      foreignColumns: [tokenLots.tenantId, tokenLots.id],
      name: "token_recognition_tenant_lot_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.holdId],
      foreignColumns: [tokenHolds.tenantId, tokenHolds.id],
      name: "token_recognition_tenant_hold_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [t.tenantId, t.ledgerTxnId],
      foreignColumns: [ledgerTransactions.tenantId, ledgerTransactions.id],
      name: "token_recognition_tenant_ledger_txn_fk",
    }).onDelete("restrict"),
    check("token_recognition_quantity_chk", sql`${t.quantity} > 0`),
    check(
      "token_recognition_position_chk",
      sql`${t.consumedBefore} >= 0
        and ${t.consumedAfter} = ${t.consumedBefore} + ${t.quantity}
        and ${t.recognizedBeforeMinor} >= 0
        and ${t.recognizedAfterMinor} = ${t.recognizedBeforeMinor} + ${t.recognitionMinor}
        and ${t.recognitionMinor} >= 0`,
    ),
    index("idx_token_recognition_lot").on(t.tenantId, t.lotId, t.createdAt),
    index("idx_token_recognition_reference").on(t.tenantId, t.referenceId),
  ],
);

export type TokenLot = typeof tokenLots.$inferSelect;
export type NewTokenLot = typeof tokenLots.$inferInsert;
export type TokenCounter = typeof tokenCounters.$inferSelect;
export type NewTokenCounter = typeof tokenCounters.$inferInsert;
export type TokenHold = typeof tokenHolds.$inferSelect;
export type NewTokenHold = typeof tokenHolds.$inferInsert;
export type TokenRecognitionAllocation =
  typeof tokenRecognitionAllocations.$inferSelect;
export type NewTokenRecognitionAllocation =
  typeof tokenRecognitionAllocations.$inferInsert;
