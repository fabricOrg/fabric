import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import {
  moneyMinor,
  type TenantId,
  tenantIdCol,
  timestamps,
} from "./_shared.js";
import { accounts } from "./identity.js";
import { ledgerTransactions } from "./wallet.js";

/**
 * TOKENS (ADR-0010 Phase 2, slice 2a) — count-based per-channel entitlements bought as a one-off
 * quantity, with NO wallet. See `docs/decisions/0010-token-subsystem-wallet-security-review.md`.
 *
 * THE SPLIT THAT MAKES THIS SAFE: these tables hold **counts, never money**. Financial truth stays in
 * the ONE existing double-entry ledger — a purchase posts
 * `debit gateway_clearing / credit token_deferred_revenue` (cash received becomes a LIABILITY: we owe
 * N sends), and consumption later recognizes revenue at the lot's locked price (slice 2c). Because no
 * column here is money-bearing, a bug in the count layer can mis-state entitlement but **cannot mint
 * or lose cash**.
 *
 * `quantity` columns are therefore plain `bigint`, deliberately NOT the branded `MinorUnits` — the
 * brand exists precisely so "a count of sends" can never be passed where "an amount of money" is
 * expected (see _shared.ts). Only `unit_price_minor_locked` / `amount_minor` are money.
 *
 * Slice 2a is ADDITIVE AND INVISIBLE: it ships the schema plus the idempotent grant. Tokens are not
 * yet spendable (send-path consumption is 2b), so NO purchase endpoint is exposed — selling a send we
 * cannot yet deliver would be dishonest. The grant's production caller (initiate + the Paystack
 * webhook branch) lands with 2c, once tokens can actually be spent.
 */

/**
 * A token purchase INTENT. Platform-level (no tenant/RLS) for exactly the reason `payments` is: the
 * provider webhook carries no tenant context and must read the intent by `reference` to learn which
 * tenant to grant. Access is api-only, always filtered by reference/tenant.
 *
 * SECURITY: the granted quantity and locked unit price come from THIS row, never from the webhook
 * payload, so a forged/replayed callback cannot inflate a grant. The `amount_minor` CHECK below makes
 * the charged amount and the entitlement arithmetically inseparable at the DB.
 */
export const tokenPurchases = pgTable(
  "token_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().$type<TenantId>(),
    /** Our idempotency key AND the provider reference, e.g. `token-{uuid}`. */
    reference: text("reference").notNull().unique(),
    provider: text("provider").notNull().default("paystack"),
    providerRef: text("provider_ref"),
    channel: text("channel").notNull(), // sms | email
    /** How many sends this purchase buys. A COUNT, not money. */
    quantity: bigint("quantity", { mode: "bigint" }).notNull(),
    /** The token book's unit price at purchase time — locked into the lot on grant (ADR-0010 #3). */
    unitPriceMinorLocked: moneyMinor("unit_price_minor_locked").notNull(),
    currency: text("currency").notNull(), // ISO 4217
    /** What the provider charges = quantity × unit_price_minor_locked (enforced below). */
    amountMinor: moneyMinor("amount_minor").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull().default("pending"), // pending | success | failed
    ...timestamps,
  },
  (t) => [
    check("token_purchases_channel_chk", sql`${t.channel} in ('sms', 'email')`),
    check(
      "token_purchases_status_chk",
      sql`${t.status} in ('pending', 'success', 'failed')`,
    ),
    check("token_purchases_quantity_chk", sql`${t.quantity} > 0`),
    check("token_purchases_price_chk", sql`${t.unitPriceMinorLocked} > 0`),
    // Correct-by-construction: the cash charged and the entitlement granted can never drift apart,
    // whatever the calling code does. Closes the "charge for 10, grant 1000" class of bug outright.
    check(
      "token_purchases_amount_chk",
      sql`${t.amountMinor} = ${t.quantity} * ${t.unitPriceMinorLocked}`,
    ),
    index("idx_token_purchases_tenant").on(t.tenantId, t.createdAt),
  ],
);

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
    /** The purchased count. A COUNT, not money. */
    quantityTotal: bigint("quantity_total", { mode: "bigint" }).notNull(),
    /** Price locked at purchase — later price-book edits never touch tokens already bought. */
    unitPriceMinorLocked: moneyMinor("unit_price_minor_locked").notNull(),
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
    check("token_lots_channel_chk", sql`${t.channel} in ('sms', 'email')`),
    check("token_lots_quantity_chk", sql`${t.quantityTotal} > 0`),
    check("token_lots_price_chk", sql`${t.unitPriceMinorLocked} > 0`),
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

export type TokenPurchase = typeof tokenPurchases.$inferSelect;
export type NewTokenPurchase = typeof tokenPurchases.$inferInsert;
export type TokenLot = typeof tokenLots.$inferSelect;
export type NewTokenLot = typeof tokenLots.$inferInsert;
export type TokenCounter = typeof tokenCounters.$inferSelect;
export type NewTokenCounter = typeof tokenCounters.$inferInsert;
