import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { moneyMinor, tenantIdCol, timestamps } from "./_shared.js";
import { accounts } from "./identity.js";

/**
 * WALLET / LEDGER domain (B3 of the build) — the crown jewel. See ARCHITECTURE.md §5,
 * MODULE-DECOMPOSITION.md §3.3, and the ratified contract `ledger-double-entry` v1.0.0
 * (team/backend-engineer/PROPOSAL-ledger-double-entry.md).
 *
 * THE ONE RULE: never store a mutable balance you edit in place. Money movement is an APPEND-ONLY
 * DOUBLE-ENTRY ledger; `ledger_accounts.balance_minor` is a CACHED PROJECTION of that ledger, not the
 * source of truth. Every movement is a BALANCED set of legs (`ledger_entries`) grouped by a
 * `ledger_transactions` row: within a transaction, SUM(credit legs) == SUM(debit legs) (the trial
 * balance). Per account the ledger must always satisfy:
 *
 *     SUM(credits) - SUM(debits) == balance_minor        (the invariant, checked continuously in CI)
 *
 * TRUE DOUBLE-ENTRY (F1/F2 resolution): a customer's balance is one account KIND among several,
 * all scoped per (tenant, currency). The spend lifecycle moves money between them — the customer
 * balance moves EXACTLY ONCE per outcome, and COMMIT is a real clearing→revenue movement:
 *   RESERVE  debit customer          / credit reserved_clearing   (balance ↓ once, funds parked)
 *   COMMIT   debit reserved_clearing / credit revenue             (recognized; balance untouched)
 *   REFUND   debit reserved_clearing / credit customer            (balance ↑ back once)
 *   TOP-UP   debit gateway_clearing  / credit customer            (external funds in)
 * Scoping system accounts per-tenant means every leg carries tenant_id → existing RLS is unchanged.
 *
 * WHY minor units as bigint: money is exact integer pesewas/kobo/cents — never a float (0.1+0.2≠0.3)
 * and never a plain JS number for large totals. The `MinorUnits` brand (see _shared) stops a segment
 * count being mistaken for an amount.
 *
 * All tables are tenant-scoped (carry tenant_id → RLS applies, see sql/0002). The `wallets` NAME
 * survives as a security-invoker VIEW over `ledger_accounts WHERE kind='customer'` (created in
 * sql/0002) so the customer-facing API is unaffected by the generalization.
 */

// The kind of money movement a transaction represents (groups its legs). Typed so the reserve/
// commit/refund state machine and reporting can't drift onto an unknown string.
export const ledgerTxnType = pgEnum("ledger_txn_type", [
  "topup", // external funds credited in (payment provider)
  "sms_charge", // a send: reserve → commit lifecycle
  "adjustment", // reconciliation delta (actual segments ≠ estimate)
  "refund", // reservation released back (provider rejected the send)
  // ADR-0010 Phase 2: a token purchase. Cash in against a DEFERRED-REVENUE liability rather than the
  // customer balance — token buyers have no wallet. Excluded from the B6 resolution index below,
  // whose predicate is type = 'sms_charge'.
  "token_purchase",
  // Discharging that liability as a token is actually spent (revenue recognition). A separate type
  // from the purchase because reporting groups on it — labelling a consumption "token_purchase"
  // would misstate both sides.
  "token_consume",
]);

// A transaction's lifecycle. A reserve opens `pending`; commit/refund closes it.
export const ledgerTxnStatus = pgEnum("ledger_txn_status", [
  "pending",
  "committed",
  "refunded",
  "reconciled",
]);

// A single leg's direction. credit = money in, debit = money out. amount is ALWAYS positive; the
// direction (not the sign) carries the meaning — this is what makes the invariant sum well-defined.
export const ledgerDirection = pgEnum("ledger_direction", ["credit", "debit"]);

// WHY a typed reason (not free text): the balance/billing logic branches on it, so an unknown value
// is a bug we want the compiler + DB to reject. Mirrors the spend lifecycle in ARCHITECTURE §5.
export const ledgerReason = pgEnum("ledger_reason", [
  "topup",
  // The sms_* reasons predate multi-channel managed messaging (SDK-007). Managed spend is now
  // channel-neutral, so reserve/commit/refund write the message_* reasons; the sms_* values are
  // retained (never dropped from an enum) so in-flight and historical SMS ledger rows still resolve.
  "sms_reserve",
  "sms_commit",
  "sms_refund",
  "message_reserve",
  "message_commit",
  "message_refund",
  // ADR-0010 Phase 2 token lifecycle (see the token-subsystem review). All three land together
  // because an enum value is a type domain, not code: adding them in one migration avoids a second
  // fiddly ADD VALUE later. `token_purchase` is written by slice 2a; `token_consume` (recognize
  // revenue as a send clears, at the lot's locked price) and `token_breakage` (forfeiture — unused
  // tokens are NON-refundable per the ADR follow-up) by slice 2c.
  "token_purchase",
  "token_consume",
  "token_breakage",
  "adjustment",
]);

// Soft-close only — accounts are never hard-deleted (F4); status is the source of truth the BFF
// checks on session refresh (a 'frozen'/'closed' account fails closed at login).
export const ledgerAccountStatus = pgEnum("ledger_account_status", [
  "active",
  "frozen",
  "closed",
]);

// The KIND of ledger account (F1 double-entry). 'customer' is the tenant's prepaid balance (exposed
// as the `wallets` view); the rest are platform-owned contra accounts, all scoped per (tenant,ccy):
//   reserved_clearing — funds parked for in-flight sends (not yet revenue); nets to 0 per resolved msg
//   revenue           — recognized SMS revenue
//   gateway_clearing  — contra for external top-ups (cash received; ↔ PSP settlement recon = fast-follow)
//   writeoff          — goodwill / manual maker-checker adjustment contra
export const ledgerAccountKind = pgEnum("ledger_account_kind", [
  "customer",
  "reserved_clearing",
  "revenue",
  "gateway_clearing",
  "writeoff",
  // ADR-0010 Phase 2: a LIABILITY contra — cash taken for tokens not yet sent. A purchase credits it
  // (we owe N sends); consumption debits it into `revenue` at the lot's locked price, so revenue is
  // recognized as tokens are used, never at purchase. Per (tenant, currency) like every other kind.
  "token_deferred_revenue",
]);

// One account per (tenant, currency, kind) — MULTI-CURRENCY from day one (decision #10). No default
// currency: a tenant may hold GHS/NGN/USD side by side. `balance_minor` is the cached projection;
// `version` is optimistic-concurrency guard so two concurrent spends can't race the same balance.
// System-account rows (non-customer kinds) are auto-provisioned LAZILY on first use, in-tenant-txn.
export const ledgerAccounts = pgTable(
  "ledger_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // F4: RESTRICT — an account delete must never cascade-shred ledger history. Accounts soft-close.
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    kind: ledgerAccountKind("kind").notNull(),
    currency: char("currency", { length: 3 }).notNull(), // ISO 4217, e.g. 'GHS'
    balanceMinor: moneyMinor("balance_minor").notNull().default(sql`0`),
    version: bigint("version", { mode: "bigint" }).notNull().default(sql`0`),
    status: ledgerAccountStatus("status").notNull().default("active"),
    ...timestamps,
  },
  // drizzle 0.45: the 3rd pgTable arg returns an ARRAY (the object form is deprecated).
  (t) => [
    // exactly one account per (tenant, currency, kind) — the reserve/commit/refund paths rely on
    // this to locate THE account for each leg. Replaces the old uniq_wallet_tenant_currency.
    unique("uniq_ledger_account_tenant_currency_kind").on(
      t.tenantId,
      t.currency,
      t.kind,
    ),
  ],
);

// The transaction envelope: groups the 2+ legs of one money movement and carries the idempotency
// key. WHY the key lives here (not on entries): a retried request must be exactly-once at the
// TRANSACTION level. UNIQUE(tenant_id, idempotency_key) → a replay hits the constraint and we
// return the stored result instead of moving money twice.
export const ledgerTransactions = pgTable(
  "ledger_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // F4: RESTRICT — never cascade-delete money history when an account is removed.
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    type: ledgerTxnType("type").notNull(),
    status: ledgerTxnStatus("status").notNull().default("pending"),
    // B8: NOT NULL — every money movement MUST carry a deterministic idempotency key so dedupe is
    // always enforced by the DB, never a read-then-write race. Keys are derived server-side:
    // topup:{topupId}, reserve:{msgId}, commit:{msgId}, refund:{msgId}, adjust:{...}.
    idempotencyKey: text("idempotency_key").notNull(),
    // manual maker-checker adjustments store {reason_code, contra_kind} here (see contract §3).
    metadata: jsonb("metadata").notNull().default({}),
    // what this txn is ABOUT (e.g. the message being resolved). Drives the B6 backstop below.
    referenceType: text("reference_type"), // 'message' | 'payment' | ...
    referenceId: uuid("reference_id"),
    ...timestamps,
  },
  // drizzle 0.45: the 3rd pgTable arg returns an ARRAY (the object form is deprecated).
  (t) => [
    // exactly-once for money: a retried request with the same key cannot open a second transaction.
    unique("uniq_ledger_txn_idempotency").on(t.tenantId, t.idempotencyKey),
    // Composite target for tenant-bound references such as recognition allocations. A globally
    // unique id is not enough to prove that a referencing tenant owns the transaction.
    unique("uniq_ledger_txn_tenant_id").on(t.tenantId, t.id),
    // B8: reject an empty-string key at the DB — NOT NULL alone would let '' through as a wildcard.
    check(
      "ledger_txn_idempotency_key_non_empty",
      sql`length(${t.idempotencyKey}) > 0`,
    ),
    // B6 DB BACKSTOP (commit-XOR-refund): at most ONE terminal-resolution txn per message. The
    // deterministic keys commit:{msgId}/refund:{msgId} are DIFFERENT, so uniqIdempotency alone
    // does NOT stop a concurrent DLR-commit and sweeper-refund both landing → reserved_clearing
    // goes negative, invariant breaks. This partial unique index closes that at the DB level:
    // a message can have at most one committed|refunded sms_charge txn — the second collides.
    // (Belt-and-suspenders: the PRIMARY guard is the engine's message-row terminal state machine
    // + FOR UPDATE in both the DLR handler and the sweeper, F5 lane. Holds under either txn model:
    // exactly one terminal-status txn exists per message whether commit transitions the reserve
    // txn or opens its own.) NULL reference_id (topups) is excluded by the type predicate.
    uniqueIndex("uniq_ledger_txn_resolution_per_message")
      .on(t.tenantId, t.referenceId)
      .where(sql`type = 'sms_charge' AND status IN ('committed', 'refunded')`),
    index("idx_ledger_txn_tenant_created").on(t.tenantId, t.createdAt),
  ],
);

// The append-only truth. NEVER updated or deleted — corrections are new `adjustment` legs. Each row
// is one leg; `txn_id` groups the legs of a transaction; per wallet the credits minus debits equal
// the cached balance. `amount_minor > 0` is enforced at the DB (a leg is a magnitude; direction
// carries the sign).
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // F4: RESTRICT — the append-only ledger must never be cascade-deleted with an account.
    tenantId: tenantIdCol().references(() => accounts.id, {
      onDelete: "restrict",
    }),
    txnId: uuid("txn_id")
      .notNull()
      .references(() => ledgerTransactions.id, { onDelete: "restrict" }),
    // each leg posts against ONE account (customer or a system contra account, per F1).
    accountId: uuid("account_id")
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: "restrict" }),
    direction: ledgerDirection("direction").notNull(),
    amountMinor: moneyMinor("amount_minor").notNull(),
    reason: ledgerReason("reason").notNull(),
    referenceType: text("reference_type"), // 'message' | 'payment' | ...
    referenceId: uuid("reference_id"),
    // append-only: creation time only, no updated_at (rows are immutable by design).
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // drizzle 0.45: the 3rd pgTable arg returns an ARRAY (the object form is deprecated).
  (t) => [
    check("ledger_entry_amount_positive", sql`${t.amountMinor} > 0`),
    // the invariant check + balance projection scan by account; keeps that O(rows-per-account).
    index("idx_ledger_entries_account").on(t.accountId),
    index("idx_ledger_entries_txn").on(t.txnId),
  ],
);

// Drizzle infers these from the schema above — one source of truth, no drift (matches identity.ts).
export type LedgerAccount = typeof ledgerAccounts.$inferSelect;
export type NewLedgerAccount = typeof ledgerAccounts.$inferInsert;
// A customer wallet is a ledger_account of kind='customer' (exposed via the `wallets` view). The
// `Wallet` alias keeps callers readable without reintroducing a separate table.
export type Wallet = LedgerAccount;
export type LedgerTransaction = typeof ledgerTransactions.$inferSelect;
export type NewLedgerTransaction = typeof ledgerTransactions.$inferInsert;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type NewLedgerEntry = typeof ledgerEntries.$inferInsert;
