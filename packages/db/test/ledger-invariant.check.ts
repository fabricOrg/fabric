// ============================================================================================
// LEDGER INVARIANT CHECK — the pinned money-correctness assertion (QA / adams)
// Bound to contract `ledger-double-entry` v1.0.0 (newton's PROPOSAL §6/§7).
//
// PROPOSAL ARTIFACT — target location: packages/db/test/ledger-invariant.check.ts
// (final path to be confirmed with newton against his migration). Framework-agnostic: it takes a
// query executor, so BOTH the Vitest integration test AND the standing CI job import the same
// assertions — one definition of "the ledger is correct", no drift.
//
// THE TWO INVARIANTS (see PROPOSAL §6):
//   1. Per-transaction trial balance:  for every txn_id,  Σ(credit) − Σ(debit) = 0.
//        (double-entry: every movement's legs sum to zero — catches a class of bugs a
//         balance-only check misses.)
//   2. Per-account projection integrity:  balance_minor = Σ(credit) − Σ(debit) of the account's legs.
//        (the cached projection can never drift from the append-only truth.)
//
// Amounts are exact integer minor units (bigint). We compute in SQL with bigint arithmetic and
// return only VIOLATING rows — a correct ledger yields empty arrays.
// ============================================================================================

/** Minimal executor shape so this binds to node-postgres, Drizzle's session, or a test pool alike. */
export interface SqlExecutor {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface TxnImbalance {
  txnId: string;
  /** Σ signed legs (credit − debit) in minor units; non-zero = the txn does not balance. */
  netMinor: string;
}

export interface AccountDrift {
  accountId: string;
  kind: string;
  currency: string;
  storedBalanceMinor: string;
  derivedBalanceMinor: string;
}

export interface LedgerInvariantResult {
  ok: boolean;
  imbalancedTxns: TxnImbalance[];
  driftedAccounts: AccountDrift[];
  /** ledger tables the invariant queries need but that are absent (unmigrated / partial migration). */
  missingTables: string[];
}

// The tables the two invariant queries read. If either is absent (unmigrated or a half-applied
// migration), the raw queries would throw 42P01 — the standing gate must instead report a CLEAN
// violation ("migration did not apply?"), exactly like the security check does. Guarded up front.
const REQUIRED_LEDGER_TABLES = ["ledger_entries", "ledger_accounts"] as const;

/** Which REQUIRED_LEDGER_TABLES are missing — `to_regclass` returns NULL for an absent relation. */
export async function findMissingLedgerTables(
  db: SqlExecutor,
): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT ${REQUIRED_LEDGER_TABLES.map(
      (t) => `to_regclass('public.${t}') IS NOT NULL AS "${t}"`,
    ).join(", ")}`,
  );
  const present = rows[0] ?? {};
  return REQUIRED_LEDGER_TABLES.filter((t) => present[t] !== true);
}

// A leg's signed contribution: credit adds, debit subtracts (PROPOSAL §3 sign convention:
// account balance_minor = Σ credit − Σ debit).
const SIGNED_LEG = `CASE WHEN direction = 'credit' THEN amount_minor ELSE -amount_minor END`;

/**
 * Invariant 1 — per-transaction trial balance. Every txn_id's legs must sum to zero.
 * Returns the txns that DON'T (empty = healthy).
 */
export async function findImbalancedTxns(
  db: SqlExecutor,
): Promise<TxnImbalance[]> {
  const { rows } = await db.query(`
    SELECT txn_id, SUM(${SIGNED_LEG})::text AS net_minor
    FROM ledger_entries
    GROUP BY txn_id
    HAVING SUM(${SIGNED_LEG}) <> 0
  `);
  return rows.map((r) => ({
    txnId: String(r.txn_id),
    netMinor: String(r.net_minor),
  }));
}

/**
 * Invariant 2 — per-account projection integrity. Each account's cached balance_minor must equal
 * the signed sum of its legs. Returns drifted accounts (empty = healthy). LEFT JOIN so an account
 * with zero legs (freshly lazy-provisioned system account) is validated as balance 0.
 */
export async function findDriftedAccounts(
  db: SqlExecutor,
): Promise<AccountDrift[]> {
  const { rows } = await db.query(`
    SELECT a.id, a.kind, a.currency,
           a.balance_minor::text AS stored,
           COALESCE(SUM(${SIGNED_LEG.replace(/amount_minor/g, "e.amount_minor").replace("direction", "e.direction")}), 0)::text AS derived
    FROM ledger_accounts a
    LEFT JOIN ledger_entries e ON e.account_id = a.id
    GROUP BY a.id, a.kind, a.currency, a.balance_minor
    HAVING a.balance_minor <> COALESCE(SUM(${SIGNED_LEG.replace(/amount_minor/g, "e.amount_minor").replace("direction", "e.direction")}), 0)
  `);
  return rows.map((r) => ({
    accountId: String(r.id),
    kind: String(r.kind),
    currency: String(r.currency),
    storedBalanceMinor: String(r.stored),
    derivedBalanceMinor: String(r.derived),
  }));
}

/**
 * Run both invariants. Used by the Vitest integration test (assert result.ok) AND the standing CI
 * job (exit non-zero + print violations if !ok). A healthy ledger => { ok: true, [], [] }.
 */
export async function checkLedgerInvariants(
  db: SqlExecutor,
): Promise<LedgerInvariantResult> {
  // Fail CLEAN (not a 42P01 crash) if the ledger schema isn't there — a gate run against an
  // unmigrated / partially-migrated DB reports "migration did not apply", parity with the security check.
  const missingTables = await findMissingLedgerTables(db);
  if (missingTables.length > 0) {
    return {
      ok: false,
      imbalancedTxns: [],
      driftedAccounts: [],
      missingTables,
    };
  }
  const [imbalancedTxns, driftedAccounts] = await Promise.all([
    findImbalancedTxns(db),
    findDriftedAccounts(db),
  ]);
  return {
    ok: imbalancedTxns.length === 0 && driftedAccounts.length === 0,
    imbalancedTxns,
    driftedAccounts,
    missingTables,
  };
}

/** Human-readable failure report for CI logs / test messages. */
export function formatViolations(r: LedgerInvariantResult): string {
  if (r.ok)
    return "ledger invariants OK (trial balance + projection integrity)";
  const lines: string[] = [];
  if (r.missingTables.length) {
    for (const t of r.missingTables)
      lines.push(
        `✗ ledger table '${t}' not found in DB — migration did not apply?`,
      );
  }
  if (r.imbalancedTxns.length) {
    lines.push(
      `✗ ${r.imbalancedTxns.length} txn(s) do not balance (Σ signed legs ≠ 0):`,
    );
    for (const t of r.imbalancedTxns)
      lines.push(`    txn ${t.txnId}: net ${t.netMinor} minor`);
  }
  if (r.driftedAccounts.length) {
    lines.push(
      `✗ ${r.driftedAccounts.length} account(s) drifted (balance_minor ≠ Σ legs):`,
    );
    for (const a of r.driftedAccounts)
      lines.push(
        `    ${a.kind}/${a.currency} ${a.accountId}: stored ${a.storedBalanceMinor} ≠ derived ${a.derivedBalanceMinor}`,
      );
  }
  return lines.join("\n");
}
