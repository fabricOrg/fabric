// ============================================================================================
// GENERAL-LEDGER INVARIANT CHECK — the money-correctness assertion for the CORPORATE books.
// The deliberate counterpart of ledger-invariant.ts, which does the same job for the tenant
// subledger. See ADR-0013.
//
// Lives in src/ (exported from @app/db) so the standing db:assert CLI (scripts/assert.ts, gate `gl`)
// and the Vitest integration test import the SAME assertions — one definition of "the company's books
// are correct". Framework-agnostic: takes a query executor.
//
// THE THREE INVARIANTS:
//   1. Per-journal trial balance:  for every journal,  Σ(credit) − Σ(debit) = 0.
//   2. Declared completeness:      every journal's actual line count equals its `line_count`.
//   3. Nothing unposted:           no posting request is parked `failed`, and none has sat `pending`
//                                  past the staleness threshold.
//
// Invariant 3 is what makes "every movement reaches the books" an assertion rather than a claim.
// Invariants 1 and 2 only check journals against THEMSELVES, so a movement that never posted at all is
// invisible to them: a request parked `failed` is skipped by the drain's `WHERE status = 'pending'`
// forever, every drain counter reads zero, and the books quietly understate revenue. The one error log
// at the moment of parking is not a standing signal — it ages out.
//
// There is deliberately no projection-integrity check, because there is no cached balance table to
// drift (see the schema header): a balance IS the signed sum of the lines.
//
// Invariant 2 looks redundant against the write-time triggers, and that is the point — it is the
// standing assertion that the triggers were never dropped or disabled. It is strictly stronger than a
// "has at least two lines" check: deleting a BALANCED subset of a journal's lines leaves it balanced
// with two lines, so only the declared count catches it.
//
// Amounts are exact integer minor units (bigint), computed in SQL. Healthy books yield empty arrays.
// ============================================================================================

import type { SqlExecutor } from "./ledger-invariant.js";

export interface GlJournalImbalance {
  journalId: string;
  idempotencyKey: string;
  /** Σ signed lines (credit − debit) in minor units; non-zero = the journal does not balance. */
  netMinor: string;
}

export interface GlIncompleteJournal {
  journalId: string;
  idempotencyKey: string;
  declaredLines: string;
  actualLines: string;
}

export interface GlUnpostedMovement {
  requestId: string;
  ledgerTxnId: string;
  status: string;
  attempts: string;
  ageMinutes: string;
  lastError: string | null;
}

export interface GlInvariantResult {
  ok: boolean;
  imbalancedJournals: GlJournalImbalance[];
  incompleteJournals: GlIncompleteJournal[];
  /** Movements that have not reached the books: parked, or pending past the threshold. */
  unpostedMovements: GlUnpostedMovement[];
  /** GL tables the queries need but that are absent (unmigrated / partial migration). */
  missingTables: string[];
}

const REQUIRED_GL_TABLES = [
  "gl_accounts",
  "gl_journals",
  "gl_journal_lines",
  "gl_posting_requests",
] as const;

/**
 * How long a request may sit `pending` before it counts as unposted. Generous relative to the
 * per-minute drain: this should catch a stuck or disabled drain, not a busy one.
 */
const DEFAULT_STALE_PENDING_MINUTES = 60;

// Σ credits − Σ debits, the uniform sign convention shared with the subledger (ADR-0013 #7).
const SIGNED_LINE = `CASE l.direction WHEN 'credit' THEN l.amount_minor ELSE -l.amount_minor END`;

/** Which REQUIRED_GL_TABLES are missing — `to_regclass` returns NULL for an absent relation. */
export async function findMissingGlTables(db: SqlExecutor): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT ${REQUIRED_GL_TABLES.map(
      (t) => `to_regclass('public.${t}') IS NOT NULL AS "${t}"`,
    ).join(", ")}`,
  );
  const present = rows[0] ?? {};
  return REQUIRED_GL_TABLES.filter((t) => present[t] !== true);
}

/** Invariant 1 — every journal's lines must sum to zero. Returns the journals that don't. */
export async function findImbalancedGlJournals(
  db: SqlExecutor,
): Promise<GlJournalImbalance[]> {
  const { rows } = await db.query(`
    SELECT j.id, j.idempotency_key, SUM(${SIGNED_LINE})::text AS net_minor
    FROM gl_journals j
    JOIN gl_journal_lines l ON l.journal_id = j.id
    GROUP BY j.id, j.idempotency_key
    HAVING SUM(${SIGNED_LINE}) <> 0
  `);
  return rows.map((r) => ({
    journalId: String(r.id),
    idempotencyKey: String(r.idempotency_key),
    netMinor: String(r.net_minor),
  }));
}

/**
 * Invariant 2 — a journal must carry exactly the lines it declared. A LEFT JOIN so a journal whose
 * lines were all removed is caught, not only one that is short or has been appended to.
 */
export async function findIncompleteGlJournals(
  db: SqlExecutor,
): Promise<GlIncompleteJournal[]> {
  const { rows } = await db.query(`
    SELECT j.id, j.idempotency_key, j.line_count::text AS declared,
           COUNT(l.id)::text AS actual
    FROM gl_journals j
    LEFT JOIN gl_journal_lines l ON l.journal_id = j.id
    GROUP BY j.id, j.idempotency_key, j.line_count
    HAVING COUNT(l.id) <> j.line_count
  `);
  return rows.map((r) => ({
    journalId: String(r.id),
    idempotencyKey: String(r.idempotency_key),
    declaredLines: String(r.declared),
    actualLines: String(r.actual),
  }));
}

/**
 * Invariant 3 — every subledger movement must have reached the books. Reports requests parked `failed`
 * and requests still `pending` past `stalePendingMinutes`.
 *
 * Both are "the books are incomplete", which is why they are one invariant rather than a metric: a
 * parked request is permanent until someone acts, and there is deliberately no automatic requeue —
 * silently retrying a payload a human has not looked at is how a real defect gets buried.
 */
export async function findUnpostedMovements(
  db: SqlExecutor,
  stalePendingMinutes: number = DEFAULT_STALE_PENDING_MINUTES,
): Promise<GlUnpostedMovement[]> {
  const { rows } = await db.query(`
    SELECT id, ledger_txn_id, status::text AS status, attempts::text AS attempts,
           (EXTRACT(EPOCH FROM (now() - created_at)) / 60)::bigint::text AS age_minutes,
           last_error
    FROM gl_posting_requests
    WHERE status = 'failed'
       OR (status = 'pending'
           AND created_at < now() - interval '${Number(stalePendingMinutes)} minutes')
    ORDER BY created_at
  `);
  return rows.map((r) => ({
    requestId: String(r.id),
    ledgerTxnId: String(r.ledger_txn_id),
    status: String(r.status),
    attempts: String(r.attempts),
    ageMinutes: String(r.age_minutes),
    lastError: r.last_error === null ? null : String(r.last_error),
  }));
}

/**
 * An account's balance is `Σ credits − Σ debits` over its lines, per currency — there is no stored
 * projection to read (see the schema header). This is the one definition of a GL balance, shared by
 * the reconciliation and by reporting so the two cannot disagree.
 */
export async function glAccountBalances(
  db: SqlExecutor,
): Promise<Array<{ code: string; currency: string; balanceMinor: string }>> {
  const { rows } = await db.query(`
    SELECT a.code, j.currency, SUM(${SIGNED_LINE})::text AS balance_minor
    FROM gl_journal_lines l
    JOIN gl_journals j ON j.id = l.journal_id
    JOIN gl_accounts a ON a.id = l.account_id
    GROUP BY a.code, j.currency
    ORDER BY a.code, j.currency
  `);
  return rows.map((r) => ({
    code: String(r.code),
    currency: String(r.currency),
    balanceMinor: String(r.balance_minor),
  }));
}

/**
 * Run both invariants. Used by the Vitest integration test (assert result.ok) AND the standing
 * gate (exit non-zero + print violations if !ok). Healthy books => { ok: true, [], [] }.
 */
export async function checkGlInvariants(
  db: SqlExecutor,
  options: { stalePendingMinutes?: number } = {},
): Promise<GlInvariantResult> {
  // Fail CLEAN (not a 42P01 crash) if the GL schema isn't there — a gate run against an unmigrated
  // DB must report "migration did not apply", parity with checkLedgerInvariants.
  const missingTables = await findMissingGlTables(db);
  if (missingTables.length > 0) {
    return {
      ok: false,
      imbalancedJournals: [],
      incompleteJournals: [],
      unpostedMovements: [],
      missingTables,
    };
  }
  const [imbalancedJournals, incompleteJournals, unpostedMovements] =
    await Promise.all([
      findImbalancedGlJournals(db),
      findIncompleteGlJournals(db),
      findUnpostedMovements(db, options.stalePendingMinutes),
    ]);
  return {
    ok:
      imbalancedJournals.length === 0 &&
      incompleteJournals.length === 0 &&
      unpostedMovements.length === 0,
    imbalancedJournals,
    incompleteJournals,
    unpostedMovements,
    missingTables,
  };
}

/** Human-readable failure report for CI logs / test messages. */
export function formatGlViolations(r: GlInvariantResult): string {
  if (r.ok) {
    return "general-ledger invariants OK (trial balance + declared completeness + nothing unposted)";
  }
  const lines: string[] = [];
  for (const t of r.missingTables) {
    lines.push(`✗ GL table '${t}' not found in DB — migration did not apply?`);
  }
  if (r.imbalancedJournals.length) {
    lines.push(
      `✗ ${r.imbalancedJournals.length} journal(s) do not balance (Σ signed lines ≠ 0):`,
    );
    for (const j of r.imbalancedJournals) {
      lines.push(
        `    ${j.idempotencyKey} (${j.journalId}): net ${j.netMinor} minor`,
      );
    }
  }
  if (r.unpostedMovements.length) {
    lines.push(
      `✗ ${r.unpostedMovements.length} subledger movement(s) have NOT reached the books:`,
    );
    for (const m of r.unpostedMovements) {
      lines.push(
        `    ledger_txn ${m.ledgerTxnId}: ${m.status}, ${m.attempts} attempt(s), ${m.ageMinutes}m old — ${m.lastError ?? "no error recorded"}`,
      );
    }
  }
  if (r.incompleteJournals.length) {
    lines.push(
      `✗ ${r.incompleteJournals.length} journal(s) do not carry their declared lines (history altered?):`,
    );
    for (const j of r.incompleteJournals) {
      lines.push(
        `    ${j.idempotencyKey} (${j.journalId}): declares ${j.declaredLines}, has ${j.actualLines}`,
      );
    }
  }
  return lines.join("\n");
}
