# PROPOSAL — Double-entry ledger correction + reserve→commit→refund spec

**Status:** PROPOSAL ONLY — not applied. Awaiting human ratification (PM: fifi). No migration is run
against any DB (redline: `schema-migration-on-shared-db`). This document is the artifact to ratify.
**Author:** newton (backend / money-correctness lens) · **Reviewer for AC-fit:** pascal (B3 author)
**Resolves:** F1 (single-entry), F2 (reserve/commit double-charge ambiguity), F4 (cascade-deletes ledger).
**Aligns:** F3.1 AC ("balance derived from entries; pending→posted; reversals = compensating entries",
Modern Treasury) · adams' trial-balance CI gate · edison's maker-checker UX · vivian's lifecycle seam.

---

## 1. The problem (F1 + F2)

`ARCHITECTURE §5` promises *"every movement is two entries that sum to zero,"* but the current schema has
**only tenant wallets** — every `ledger_entries.wallet_id` points at a customer wallet, so a top-up or
charge posts **one** leg. The CI invariant `SUM(credits)−SUM(debits)==balance_minor` is a *per-wallet
balance projection*, **not** a double-entry trial balance. You cannot derive revenue, float, or reserved
liability from the ledger. And the enum carries both `sms_reserve` **and** `sms_commit` reasons while the
balance is debited only at reserve — leaving COMMIT's semantics undefined (dead reason, or double-charge).

**Root cause:** there is no *contra account* — no platform-owned side for money to move to/from.

## 2. The model — per-tenant system accounts

Introduce the missing accounts, scoped **per (tenant, currency)** — deliberately, so:
- every leg still carries `tenant_id` → **existing RLS policies work unchanged** (no cross-tenant-account
  complexity); a transaction's legs all share one `tenant_id` and sum to zero *within* that tenant.
- per-tenant `revenue`/`reserved` is *more* useful for reporting (revenue by tenant, float by tenant);
  platform-wide revenue = `SUM` over tenants.

| account `kind`     | meaning                                             | scope            |
|--------------------|-----------------------------------------------------|------------------|
| `customer`         | the customer's prepaid balance (today's `wallets`)  | per tenant+ccy   |
| `reserved_clearing`| funds parked for in-flight sends (not yet revenue)  | per tenant+ccy   |
| `revenue`          | recognized SMS revenue                              | per tenant+ccy   |
| `gateway_clearing` | contra for external top-ups (cash received)         | per tenant+ccy   |
| `writeoff`         | goodwill / manual-adjustment contra (maker-checker) | per tenant+ccy   |

Generalize `wallets` → **`ledger_accounts`** with a `kind`. `wallets` survives as a **view**
(`WHERE kind='customer'`) so `GET /v1/wallet` and existing callers are unaffected. `ledger_entries.wallet_id`
becomes **`account_id` → ledger_accounts.id**. (B3 is not deployed — this is schema-shaping done now,
which is precisely the cheap-now/painful-later window.)

## 3. The lifecycle — every movement is a balanced 2-leg (F2)

Sign convention unchanged: an account's `balance_minor = SUM(credit) − SUM(debit)` of its legs.

| step | legs (both share one `txn_id`, `tenant_id`, sum to zero)                          | reason        | customer balance |
|------|-----------------------------------------------------------------------------------|---------------|------------------|
| **Top-up**  | `DEBIT gateway_clearing` · `CREDIT customer`                               | `topup`       | ↑ once           |
| **Reserve** | `DEBIT customer` · `CREDIT reserved_clearing`                              | `sms_reserve` | ↓ once           |
| **Commit**  | `DEBIT reserved_clearing` · `CREDIT revenue`                               | `sms_commit`  | untouched        |
| **Refund**  | `DEBIT reserved_clearing` · `CREDIT customer`                             | `sms_refund`  | ↑ back once      |
| **Reconcile ↑** | `DEBIT customer` · `CREDIT revenue` (actual segs > estimate)          | `adjustment`  | ↓ delta          |
| **Reconcile ↓** | `DEBIT revenue` · `CREDIT customer` (actual segs < estimate)          | `adjustment`  | ↑ delta          |
| **Manual adj**  | `DEBIT <contra> · CREDIT customer` (or reverse) — operator picks contra | `adjustment`  | per direction    |

**Key properties:**
- The **customer balance moves exactly once** per outcome (at reserve; restored on refund) — no
  double-charge. COMMIT becomes a *real, auditable* movement (clearing→revenue), so `sms_commit` is no
  longer a dead reason. **No new enum values needed** — `sms_reserve`/`sms_commit`/`sms_refund` map onto
  the clearing legs (pascal confirmed).
- `reserved_clearing` nets to **zero** per message once resolved → its non-zero balance = total in-flight
  float (a useful operational metric).
- **Manual adjustment (edison):** the maker must pick a **`reason_code` + explicit contra account**; the
  UI previews the balanced legs before submit; the checker approves a fully-specified movement, not a bare
  amount. Stored in `ledger_transactions.metadata` (`{reason_code, contra_kind}`) + the two legs.

## 4. F3 — one resolution per message (B6 race), restated concretely

Two independent guards (belt-and-suspenders):
1. **Terminal state machine on the reservation/message row** (products/sms, not yet built):
   `reserved → committed | refunded`, terminal; `SELECT … FOR UPDATE` + compare-and-set in **both** the
   DLR handler and the sweeper.
2. **Deterministic ledger idempotency keys**: `commit:{messageId}` / `refund:{messageId}`. Combined with
   the existing `UNIQUE(tenant_id, idempotency_key)`, a second resolver's insert **collides** → exactly
   one terminal resolution, even without the message-row lock. Both paths MUST derive the identical key
   (adams' unit test pins this).
   - Optional schema assertion once the message row lands:
     `UNIQUE(tenant_id, reference_id) WHERE reason IN ('sms_commit','sms_refund')` on `ledger_entries`.

## 5. F4 — delete policy (append-only + retention)

- `ledger_entries`, `ledger_transactions`, `erasure_log`, `audit` tenant FKs → **`ON DELETE RESTRICT`**
  (never let an account delete shred immutable financial/audit history or 5-yr erasure evidence).
- Accounts are **soft-closed** (`status='closed'`), never hard-deleted. This is also the source of truth
  the BFF checks on session refresh (vivian's lifecycle seam): a `closed`/`suspended` account fails closed
  at session validation with a blocked-login UX, not a 500 or a stale-but-valid cookie.

## 6. Invariant / CI (adams)

Upgrade from a per-wallet balance check to a **per-transaction trial balance**:
- **Per txn:** `SUM(credit legs) == SUM(debit legs)` (i.e. Σ signed legs = 0). Catches a whole class of
  bugs a balance-only check misses.
- **Per account:** `balance_minor == SUM(credit) − SUM(debit)` of its legs (projection integrity).
- Concurrency gates: F3 (concurrent DLR+sweeper → one resolution) + F6 (interleaved-pool tenant isolation,
  incl. empty/invalid GUC rejected *before* `SET LOCAL`).

## 7. Proposed schema delta (Drizzle) — PROPOSAL, not applied

```ts
// ledger_accounts (generalizes wallets)
export const ledgerAccountKind = pgEnum("ledger_account_kind", [
  "customer", "reserved_clearing", "revenue", "gateway_clearing", "writeoff",
]);

export const ledgerAccounts = pgTable("ledger_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantIdCol().references(() => accounts.id, { onDelete: "restrict" }), // F4
  kind: ledgerAccountKind("kind").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  balanceMinor: moneyMinor("balance_minor").notNull().default(ZERO_MINOR),
  version: bigint("version", { mode: "bigint" }).notNull().default(0n),
  status: walletStatus("status").notNull().default("active"),
  ...timestamps,
}, (t) => ({
  // exactly one account per (tenant, currency, kind)
  uniqAccount: unique("uniq_ledger_account").on(t.tenantId, t.currency, t.kind),
}));

// `wallets` becomes a VIEW: SELECT * FROM ledger_accounts WHERE kind='customer';  (in raw SQL migration)

// ledger_entries: wallet_id -> account_id; tenant FK -> restrict
//   accountId: uuid("account_id").notNull().references(() => ledgerAccounts.id, { onDelete: "restrict" }),
//   tenantId: tenantIdCol().references(() => accounts.id, { onDelete: "restrict" }),  // F4
// ledger_transactions.tenantId FK -> restrict (F4); metadata carries {reason_code, contra_kind} for manual adj.
```

Accompanying raw SQL (RLS) mirrors `0002_wallet_rls.sql`: `ENABLE`+`FORCE RLS` and the `tenant_isolation`
policy on `ledger_accounts`; append-only `REVOKE UPDATE,DELETE` stays on `ledger_entries`. System-account
rows are auto-provisioned per (tenant, currency) on first use, inside the tenant transaction.

## 8. Open decisions for the human / PM

1. **Negative customer balance on upward reconcile** — allow (adjustment can push below 0, blocks future
   sends via S5) or clamp? Recommend **allow** (money already spent at provider; blocking loses real cost).
   **Constraint (adams):** a negative `customer` balance is reachable **only** via an `adjustment`
   reconcile leg — the send/reserve path MUST always gate on `balance_minor >= cost` (S5), never overdraw.
2. **`ledger_accounts` generalization vs minimal diff** — recommend the generalization (B3 not deployed).
   Minimal-diff alternative: keep `wallets`, add `system_accounts`, `ledger_entries` gets a
   `wallet_id XOR system_account_id` CHECK. Uglier; only worth it if we want zero rename churn.
3. **System-account auto-provisioning** — lazy (first use) vs eager (at wallet creation). Recommend lazy.
