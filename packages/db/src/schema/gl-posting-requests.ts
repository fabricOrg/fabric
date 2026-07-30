import { sql } from "drizzle-orm";
import {
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenantIdCol, timestamps } from "./_shared.js";
import { ledgerTransactions } from "./wallet.js";

/**
 * THE POSTING AIRLOCK (ADR-0013 #10, roadmap Phase 1 slice 1b) — how a tenant transaction tells the
 * company's books that something financial happened, without being able to touch them.
 *
 * This is the ONE tenant-scoped table in the general-ledger domain, and the only one `app_runtime` may
 * write. RLS is FORCEd and the runtime policy is INSERT-ONLY: the tenant path can say "this movement
 * occurred", and cannot read the queue, alter a queued row, or post a journal. A worker running as
 * `app_provisioner` drains it (see the GL posting worker) and writes the journal.
 *
 * WHY THE ROW CARRIES ITS PAYLOAD rather than just pointing at the subledger transaction. NOT for
 * privilege reasons — `app_provisioner` can already read `ledger_entries` and `ledger_accounts`
 * cross-tenant through the `provisioner_read` policies in migration 0027. The reasons are:
 *
 *   1. It is EVIDENCE. The journal is derived from what the movement was when it happened, captured in
 *      the movement's own transaction, rather than from a re-read that could reflect later changes.
 *      That is the same instinct as locking a price at purchase.
 *   2. The drain needs no per-request join back into tenant-scoped, FORCE-RLS tables, so it stays
 *      independent of subledger schema evolution.
 *
 * The trade-off, stated plainly: a snapshot can go stale. Legs INSERTed against an ALREADY-COMMITTED
 * transaction in a later transaction are invisible to it — `ledger_transactions` has no closed-set
 * guard (no equivalent of `gl_journals.line_count`), and 0007's balance trigger accepts a balanced
 * append. Re-reading at drain time would not fix that either; only a closed-set guard on the subledger
 * would. Slice 1c's subledger-to-control-account reconciliation is what detects it.
 *
 * WHY THE ENQUEUE IS A TRIGGER, not a call in each wallet primitive: a primitive that forgets to
 * enqueue produces money movement with no counterpart in the company's books, and nothing would fail.
 * A trigger on `ledger_transactions` cannot be forgotten by a future primitive, and it is in the
 * movement's own transaction by construction — the two properties the exit gate needs.
 */

/**
 * `pending` awaits a drain; `posted` carries `posted_journal_id`; `failed` is a payload the worker
 * cannot post and must not retry forever (a human reads `last_error`). Typed so an unknown state is
 * rejected by the database rather than becoming an unqueryable row.
 */
export const glPostingStatus = pgEnum("gl_posting_status", [
  "pending",
  "posted",
  "failed",
]);

export const glPostingRequests = pgTable(
  "gl_posting_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * No `.references(accounts.id)`, unlike its sibling ledger tables. The value is copied by the
     * enqueue trigger from `ledger_transactions.tenant_id`, which already carries that FK, and adding a
     * second one would give a queue row a veto over tenant deletion for no gain — the `ledgerTxnId`
     * cascade below already removes the row when the movement goes.
     */
    tenantId: tenantIdCol(),
    /**
     * The subledger movement this describes.
     *
     * CASCADE, deliberately not the ledger's usual RESTRICT. In production a `ledger_transactions` row
     * is never deleted (DELETE is revoked from `app_runtime`), so this action never fires there. What
     * RESTRICT would actually do is make every integration spec that tears down its own ledger rows
     * fail with a foreign-key violation the moment the enqueue trigger starts producing requests — and
     * the durable audit does not depend on this row anyway: the posted journal records the same
     * `ledger_txn_id` in its own immutable `source_ref`.
     */
    ledgerTxnId: uuid("ledger_txn_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "cascade" }),
    currency: char("currency", { length: 3 }).notNull(), // ISO 4217
    /** When the movement economically occurred; becomes the journal's `event_time`. */
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    /** Reporting dimension, absent for movements that are not channel-specific (a wallet top-up). */
    channel: text("channel"),
    /**
     * The movement's legs, as `[{ account_kind, direction, amount_minor }]`. Amounts are decimal
     * STRINGS: jsonb numbers are IEEE-754 doubles, which would silently round a large minor-unit
     * amount, and money is never a float here. Parsed against `subledgerPostingEventSchema` before it
     * is trusted.
     */
    legs: jsonb("legs").notNull(),
    status: glPostingStatus("status").notNull().default("pending"),
    /** Drain attempts, so a permanently unpostable payload can be stopped rather than looped on. */
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /**
     * The journal this became — the reconciliation link. Deliberately NOT a foreign key: journals are
     * append-only and never deleted, so referential integrity buys nothing, and a tenant-scoped table
     * holding an enforced reference into the company books is a coupling with no upside.
     */
    postedJournalId: uuid("posted_journal_id"),
    ...timestamps,
  },
  (t) => [
    // One request per subledger movement. Globally unique, because a `ledger_transactions.id` is: this
    // is what makes the trigger idempotent and gives the audit "zero or one posting per movement".
    unique("uniq_gl_posting_request_txn").on(t.ledgerTxnId),
    // Double-entry needs two legs; a payload with fewer could not produce a balanced journal.
    check(
      "gl_posting_request_legs_min",
      sql`jsonb_typeof(${t.legs}) = 'array' AND jsonb_array_length(${t.legs}) >= 2`,
    ),
    check("gl_posting_request_attempts_non_negative", sql`${t.attempts} >= 0`),
    // The drain's claim query: pending rows, oldest first.
    index("idx_gl_posting_requests_pending")
      .on(t.createdAt)
      .where(sql`status = 'pending'`),
  ],
);

export type GlPostingRequest = typeof glPostingRequests.$inferSelect;
export type NewGlPostingRequest = typeof glPostingRequests.$inferInsert;
