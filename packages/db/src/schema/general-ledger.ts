import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, type TenantId, timestamps } from "./_shared.js";
import { ledgerAccountKind, ledgerDirection } from "./wallet.js";

/**
 * CORPORATE GENERAL LEDGER (ADR-0013, roadmap Phase 1) — the company's books, as distinct from the
 * per-tenant subledger in wallet.ts.
 *
 * THE BOUNDARY: `ledger_*` is a TENANT SUBLEDGER — every row carries `tenant_id`, RLS is FORCEd, and
 * it answers "may this send proceed, and what does this customer own?". `gl_*` is TENANT-NEUTRAL and
 * answers "what does Fabric own, owe, earn, and spend?" — questions the subledger cannot answer at
 * all, because it has no account for bank cash, provider expense, payables, PSP fees, or tax, and
 * because RLS makes a consolidated balance unreachable by construction.
 *
 * TENANCY vs DIMENSION: `gl_journal_lines.tenant_id` is a nullable REPORTING DIMENSION, not a
 * tenancy boundary. Company-level postings (a provider invoice, a bank fee) legitimately have no
 * tenant. These tables therefore carry no RLS tenant policy — instead the migration REVOKEs all
 * privileges from `app_runtime`, so the tenant-facing role cannot read the company books at all.
 * That revoke is load-bearing: `ALTER DEFAULT PRIVILEGES` would otherwise hand `app_runtime` DML on
 * every new table (see CLAUDE.md §9).
 *
 * SIGN CONVENTION (ADR-0013 #7): a balance is `Σ credits − Σ debits`, uniformly, for every account
 * type — the SAME convention as the subledger. That is what lets reconciliation compare the two
 * ledgers as raw numbers with no per-account-type sign handling, which is the class of bug that makes
 * a reconciliation quietly wrong. It does mean an asset account computes to a NEGATIVE figure;
 * `gl_accounts.normal_balance` carries the presentation sign so reports can negate debit-normal
 * accounts for display. Machine-friendly in the data, Finance-friendly in the report.
 *
 * Money is `bigint` minor units throughout. A journal is single-currency STRUCTURALLY (currency is a
 * column on the journal, not on the line) and balanced by WRITE-TIME ENFORCEMENT — see
 * `migrations/0112_general_ledger_enforcement.sql`. A violating write is REJECTED, never merely
 * detected later.
 */

/** Standard chart-of-accounts classification. Drives reporting rollups (P&L vs balance sheet). */
export const glAccountType = pgEnum("gl_account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

/**
 * The side on which this account NATURALLY carries a positive figure. Presentation only — storage is
 * always `Σ credits − Σ debits` (see the header). A debit-normal account is negated for display.
 */
export const glNormalBalance = pgEnum("gl_normal_balance", ["debit", "credit"]);

/**
 * What produced a journal. `ledger_txn` mirrors a subledger movement (the whole of Phase 1);
 * `manual_adjustment` is a staff-authored correction; `reversal` un-posts an earlier journal.
 * Typed so an unknown source is rejected by the database rather than becoming an unreportable row.
 */
export const glSourceKind = pgEnum("gl_source_kind", [
  "ledger_txn",
  "manual_adjustment",
  "reversal",
]);

/**
 * THE CHART OF ACCOUNTS — seeded reference data, keyed by a stable `code` (e.g. '2100').
 *
 * WHY DATA AND NOT AN ENUM: Finance adds accounts over time, and an enum `ADD VALUE` migration per
 * account is friction with no payoff. Type safety comes from the other direction — a `GlAccountCode`
 * union in TypeScript names the seeded codes, and an integration test asserts the union and the
 * seeded rows agree, so a typo still fails a gate rather than posting into a nonexistent account.
 *
 * Only the accounts Phase 1 posts to are seeded. Each later roadmap phase adds its own accounts in
 * its own migration; a chart full of unposted codes is speculation, not a chart of accounts.
 */
export const glAccounts = pgTable(
  "gl_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable external identity — reports, exports, and the TS code union all key on this. */
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: glAccountType("type").notNull(),
    normalBalance: glNormalBalance("normal_balance").notNull(),
    /**
     * Set when this account is the CONSOLIDATED CONTROL ACCOUNT for a subledger account kind — the
     * bridge ADR-0013 #4 defines. Typed as the subledger's own enum so the database itself rejects a
     * kind that does not exist; the partial unique index below stops a seed mistake nominating two
     * control accounts for one kind, which would silently split the reconciliation.
     */
    controlForKind: ledgerAccountKind("control_for_kind"),
    description: text("description"),
    ...timestamps,
  },
  (t) => [
    unique("uniq_gl_account_code").on(t.code),
    check("gl_account_code_non_empty", sql`length(${t.code}) > 0`),
    uniqueIndex("uniq_gl_account_control_for_kind")
      .on(t.controlForKind)
      .where(sql`control_for_kind IS NOT NULL`),
  ],
);

/**
 * A JOURNAL — the envelope grouping the balanced lines of one financial event. Append-only: a posted
 * journal is never edited or deleted, and a correction is a new REVERSAL (ADR-0013 #9).
 *
 * EXACTLY-ONCE (#11): `idempotency_key` is globally UNIQUE and derived from the source, as
 * `{source_kind}:{source_ref}` — for Phase 1, `ledger_txn:{ledger_transactions.id}`. Drain from the
 * posting airlock is at-least-once; this key is what makes the EFFECT exactly-once. It also gives the
 * audit a direct answer: every subledger transaction has zero or one GL journal.
 *
 * THREE TIMESTAMPS, THREE JOBS (#13): `event_time` is when the event happened economically,
 * `posted_at` is when we wrote it, and `accounting_date` is the period it belongs to (derived from
 * `event_time` in UTC). Phase 8's period locks need a date to bite on; storing it now avoids
 * restating history later.
 */
export const glJournals = pgTable(
  "gl_journals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceKind: glSourceKind("source_kind").notNull(),
    /** The originating record: a `ledger_transactions.id`, or the journal a reversal un-posts. */
    sourceRef: text("source_ref").notNull(),
    currency: char("currency", { length: 3 }).notNull(), // ISO 4217
    /**
     * How many lines this journal DECLARES. Set once at insert and immutable thereafter, it is what
     * makes a journal a closed set: a deferred trigger asserts the actual line count equals it, so
     * lines can neither be left off nor APPENDED LATER. Without it, "balanced" is the only constraint
     * and a second balanced pair inserted weeks later would pass — fabricating revenue inside a closed
     * period while every invariant still reported healthy.
     */
    lineCount: integer("line_count").notNull(),
    /** When the event economically occurred — may precede `posted_at` by the drain lag. */
    eventTime: timestamp("event_time", { withTimezone: true }).notNull(),
    /** The accounting period this lands in, derived from `event_time` in UTC. */
    accountingDate: date("accounting_date").notNull(),
    /**
     * When the row was written. Named for the accounting term rather than `created_at` because a
     * separate `created_at` would mean the same thing and invite the two to drift.
     */
    postedAt: timestamp("posted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * The journal this one reverses. UNIQUE — a journal may be reversed at most once, so a retried
     * correction cannot double-reverse and leave the books overstated in the opposite direction.
     */
    reversesJournalId: uuid("reverses_journal_id").references(
      (): AnyPgColumn => glJournals.id,
      { onDelete: "restrict" },
    ),
    memo: text("memo"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    unique("uniq_gl_journal_idempotency").on(t.idempotencyKey),
    check(
      "gl_journal_idempotency_key_non_empty",
      sql`length(${t.idempotencyKey}) > 0`,
    ),
    unique("uniq_gl_journal_reverses").on(t.reversesJournalId),
    // Double-entry needs two legs; a one-line journal cannot balance.
    check("gl_journal_line_count_min", sql`${t.lineCount} >= 2`),
    // A journal cannot reverse itself — that would satisfy the shape check below while having no
    // original, and its lines would still net to zero.
    check(
      "gl_journal_no_self_reversal",
      sql`${t.reversesJournalId} <> ${t.id}`,
    ),
    // A reversal MUST name what it reverses, and nothing else may claim to be one. Keeping the two
    // columns in lockstep at the DB means reporting can trust `source_kind` alone.
    check(
      "gl_journal_reversal_shape",
      sql`(${t.sourceKind} = 'reversal') = (${t.reversesJournalId} IS NOT NULL)`,
    ),
    index("idx_gl_journals_accounting_date").on(t.accountingDate),
    index("idx_gl_journals_source").on(t.sourceKind, t.sourceRef),
  ],
);

/**
 * A JOURNAL LINE — one leg. `amount_minor` is always a POSITIVE magnitude; `direction` carries the
 * meaning, which is what makes the trial-balance sum well-defined. Immutable: UPDATE and DELETE are
 * revoked from every role in the enforcement migration.
 *
 * `tenant_id` and `channel` are reporting DIMENSIONS, both nullable — a company-level posting has
 * neither. They are explicit columns rather than jsonb so gross-margin and per-tenant reporting can
 * index them.
 */
export const glJournalLines = pgTable(
  "gl_journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    journalId: uuid("journal_id")
      .notNull()
      .references(() => glJournals.id, { onDelete: "restrict" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => glAccounts.id, { onDelete: "restrict" }),
    // The subledger's own direction enum — one vocabulary across both ledgers, so a leg cannot mean
    // one thing in the subledger and another in the books.
    direction: ledgerDirection("direction").notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    /**
     * Reporting dimension — deliberately NOT a foreign key, unlike the subledger's RESTRICT reference
     * to `accounts`.
     *
     * Two reasons, and either alone is decisive. (1) These rows are IMMUTABLE and UNDELETABLE by
     * trigger, so no referential action is even available: `RESTRICT` would make any tenant that ever
     * appeared in a posting permanently undeletable, and `SET NULL` / `CASCADE` need an UPDATE or
     * DELETE the immutability trigger refuses. (2) A posted line records what was true when it posted;
     * that historical fact does not stop being true because the workspace was later closed. Reporting
     * left-joins `accounts` and shows an unresolved tenant as such.
     */
    tenantId: uuid("tenant_id").$type<TenantId>(),
    /** Reporting dimension: 'sms' | 'email' | a later registered channel. */
    channel: text("channel"),
    memo: text("memo"),
    // Append-only: creation time only, no updated_at (rows are immutable by design).
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check("gl_journal_line_amount_positive", sql`${t.amountMinor} > 0`),
    index("idx_gl_journal_lines_journal").on(t.journalId),
    // The projection check and per-account reporting both scan by account.
    index("idx_gl_journal_lines_account").on(t.accountId),
    index("idx_gl_journal_lines_tenant").on(t.tenantId),
  ],
);

/**
 * NO CACHED BALANCE TABLE — deliberately (ADR-0013 #7). The subledger stores
 * `ledger_accounts.balance_minor` because the send path locks that row `FOR UPDATE` to gate an
 * overdraw: money must fail closed in the hot path. The general ledger has no hot path — nothing
 * gates on a company balance — so a stored projection here would buy only a class of drift to detect
 * and a privileged trigger to maintain it. An account's balance is `Σ credits − Σ debits` over its
 * lines, computed on read; Phase 7 owns reporting performance and can add a materialized rollup then,
 * against an append-only source that cannot have drifted.
 */

export type GlAccount = typeof glAccounts.$inferSelect;
export type NewGlAccount = typeof glAccounts.$inferInsert;
export type GlJournal = typeof glJournals.$inferSelect;
export type NewGlJournal = typeof glJournals.$inferInsert;
export type GlJournalLine = typeof glJournalLines.$inferSelect;
export type NewGlJournalLine = typeof glJournalLines.$inferInsert;
