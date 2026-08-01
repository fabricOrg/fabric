import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, tenantIdCol, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";
import { tokenLots } from "./tokens.js";
import { ledgerTransactions } from "./wallet.js";

/**
 * A send's in-flight claim on tokens — the count-space mirror of a wallet `reserve` (slice 2b).
 * Lifecycle: `pending` on accept → `committed` on delivery (2c recognizes revenue at this lot's
 * locked price) → or `returned` on failure/expiry, which puts the quantity back on the counter.
 *
 * ONE HOLD ROW PER LOT. A claim that spans lots (the counter aggregates them) is split so every row
 * carries exactly one locked price, which is what makes recognition unambiguous. Lots are drawn
 * expiry-soonest then oldest, so customers consume time-limited credits before perpetual ones.
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
    channel: text("channel").notNull(),
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
    check("token_holds_quantity_chk", sql`${t.quantity} > 0`),
    // Find every hold for a send (commit/return) and sweep stuck pendings.
    index("idx_token_holds_reference").on(t.tenantId, t.referenceId),
    index("idx_token_holds_pending").on(t.tenantId, t.status, t.createdAt),
    // The expiry sweep asks "does this lot still have a pending hold?" per candidate lot, and this
    // table grows one row per lot per send forever, so that lookup needs its own index.
    index("idx_token_holds_lot_pending")
      .on(t.lotId)
      .where(sql`${t.status} = 'pending'`),
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

export type TokenHold = typeof tokenHolds.$inferSelect;
export type NewTokenHold = typeof tokenHolds.$inferInsert;
export type TokenRecognitionAllocation =
  typeof tokenRecognitionAllocations.$inferSelect;
export type NewTokenRecognitionAllocation =
  typeof tokenRecognitionAllocations.$inferInsert;
