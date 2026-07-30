// ============================================================================================
// SUBLEDGER ↔ CORPORATE CONTROL ACCOUNT RECONCILIATION — the Phase 1 exit gate (ADR-0013 #15,
// roadmap FIN-004).
//
// THE QUESTION IT ANSWERS: for every subledger account kind and currency, does the company's control
// account hold the same total as the sum of every tenant's movements of that kind?
//
// It is a DIRECT NUMERIC COMPARISON, which is the whole payoff of the shared sign convention
// (ADR-0013 #7): both ledgers compute a balance as Σ credits − Σ debits, so neither side needs
// per-account-type sign handling. That handling is the classic place a reconciliation goes quietly
// wrong.
//
// COMPLETENESS AND ACCURACY ARE SEPARATE INVARIANTS, deliberately:
//   * `checkGlInvariants` invariant 3 asks "has everything reached the books?" (nothing parked, nothing
//     stale). That is COMPLETENESS over time.
//   * This asks "for what HAS reached the books, do the totals agree?" That is ACCURACY.
// So the subledger side is scoped to movements that already have a posted journal. Without that scope
// the drain's normal lag would read as a discrepancy, the check would be permanently amber, and nobody
// would look at it.
//
// "NO DISCREPANCIES" IS NOT THE SAME AS "AGREEMENT", and conflating them is how this check would fail
// silently: an empty comparison also finds nothing wrong. `ledger_entries`, `ledger_accounts` and
// `accounts` are all FORCE RLS, and their permissive policies name `app_provisioner` only — so any
// caller that is neither superuser nor `app_provisioner`, with no `app.tenant_id` set, sees ZERO rows
// and would be told the ledgers reconcile. That is not hypothetical: `db:assert` connects as
// `DATABASE_URL_OWNER`, which is a superuser locally but the NON-superuser `app_migrator` in the cloud.
//
// Detecting that from row counts does not work: a count of `ledger_entries` is filtered to zero right
// alongside the legs, and "no legs" is also the honest state of a database whose test tenants were torn
// down. So the check asks the caller about its CAPABILITY instead — superuser, or a member of
// `app_provisioner` — which is exactly the set the policies admit, is RLS-immune, and does not depend on
// how much data happens to be present.
//
// Both sides read APPEND-ONLY records, and the subledger side sums `ledger_entries` rather than the
// cached `ledger_accounts.balance_minor`, so this does not inherit the projection's correctness as an
// assumption (that projection has its own invariant in ledger-invariant.ts).
// ============================================================================================

import { CURRENCY_LIST } from "./gl-currencies.js";
import { measureCoverage } from "./gl-reconciliation-coverage.js";
import type { SqlExecutor } from "./ledger-invariant.js";

export interface ControlAccountDiscrepancy {
  /** The subledger account kind, e.g. 'customer'. */
  kind: string;
  currency: string;
  /** Σ credits − Σ debits over subledger legs whose transaction has a posted journal. */
  subledgerMinor: string;
  /** Σ credits − Σ debits over the mapped GL control account's lines. */
  booksMinor: string;
  /** books − subledger, in minor units. Non-zero is the defect. */
  differenceMinor: string;
}

export interface GlReconciliationResult {
  ok: boolean;
  discrepancies: ControlAccountDiscrepancy[];
  /**
   * Control-account lines with NO tenant on a journal that MIRRORS a real movement. A defect: the
   * mirror must attribute money to the movement's tenant, and `tenant_id` is deliberately not a foreign
   * key so nothing else would reject it. Hand-written and adjustment journals are outside this — they
   * are under no obligation to name a tenant.
   */
  unattributedControlLines: number;
  /**
   * Control-account lines whose tenant no longer exists. Reported, but NOT a failure — see the scope
   * note on `findControlAccountDiscrepancies`.
   */
  orphanedControlLines: number;
  /** Subledger money outside the enabled currency set — money the comparison could not have covered. */
  unsupportedSubledgerCurrencies: string[];
  /**
   * What the query saw, and whether it COULD see. `blind` means this caller is neither superuser nor a
   * member of `app_provisioner`, so RLS hides the subledger from it and no result it produces means
   * anything — regardless of how many rows came back.
   */
  coverage: {
    subledgerLegs: number;
    mirrorControlLines: number;
    blind: boolean;
  };
  /** Tables the query needs but that are absent (unmigrated / partial migration). */
  missingTables: string[];
}

const REQUIRED_TABLES = [
  "accounts",
  "ledger_entries",
  "ledger_accounts",
  "gl_accounts",
  "gl_journals",
  "gl_journal_lines",
] as const;

// Σ credits − Σ debits. Same convention as ledger-invariant.ts and gl-invariant.ts (ADR-0013 #7); the
// aliases differ per query, so this stays a local constant rather than a shared fragment.
const SIGNED_LEDGER =
  "CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END";
const SIGNED_LINE =
  "CASE l.direction WHEN 'credit' THEN l.amount_minor ELSE -l.amount_minor END";

async function findMissingTables(db: SqlExecutor): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT ${REQUIRED_TABLES.map(
      (t) => `to_regclass('public.${t}') IS NOT NULL AS "${t}"`,
    ).join(", ")}`,
  );
  const present = rows[0] ?? {};
  return REQUIRED_TABLES.filter((t) => present[t] !== true);
}

/**
 * Compare each control account against the subledger kind it consolidates.
 *
 * EVERY JOURNAL KIND COUNTS — mirrors, reversals and future manual adjustments alike. A reversal moves
 * a control account as surely as a mirror does, so excluding one by `source_kind` would let real
 * divergence hide behind a label. A reversal therefore DOES show as a discrepancy until a compensating
 * correction lands, which is right: the ledgers genuinely disagree in that interval.
 *
 * The subledger side joins on `(source_kind, source_ref)` — the structural, indexed columns — rather
 * than on a reconstructed `idempotency_key`. Nothing constrains that key to equal
 * `{source_kind}:{source_ref}`, so matching on it would let a manual adjustment keyed
 * `ledger_txn:{uuid}` masquerade as a movement's mirror; and the concatenation is not indexable.
 *
 * SCOPED TO THE ENABLED CURRENCIES. `gl_journals.currency` and `ledger_accounts.currency` are bare
 * `char(3)` with no constraint. Rather than let that silently narrow the comparison, the subledger side
 * is separately checked for money outside the set — money enters through the subledger, so that is
 * where the hole would have to open.
 *
 * SCOPED TO WORKSPACES THAT STILL EXIST, which needs justifying because "exclude rows you find
 * inconvenient" is how reconciliations go wrong. Journal lines are immutable; subledger movements are
 * not. Deleting a tenant requires deleting its ledger rows first (RESTRICT), and the lines those
 * movements produced survive by design — an un-reconcilable remainder that would hold every future
 * comparison red, which equals having no gate. Near-unreachable in production (no application role can
 * delete ledger history); routine in tests. The excluded rows are COUNTED and reported rather than
 * silently dropped, and a line with no tenant at all is a failure, not residue.
 *
 * A FULL OUTER JOIN so drift is caught in both directions.
 */
export async function findControlAccountDiscrepancies(
  db: SqlExecutor,
): Promise<ControlAccountDiscrepancy[]> {
  const { rows } = await db.query(`
    WITH subledger AS (
      SELECT a.kind::text AS kind, a.currency AS currency, SUM(${SIGNED_LEDGER}) AS net
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      -- Only movements the books have actually seen; drain lag is invariant 3's business, not ours.
      JOIN gl_journals gj
        ON gj.source_kind = 'ledger_txn' AND gj.source_ref = e.txn_id::text
      WHERE a.currency IN ${CURRENCY_LIST}
      GROUP BY 1, 2
    ),
    books AS (
      SELECT ga.control_for_kind::text AS kind, gj.currency AS currency, SUM(${SIGNED_LINE}) AS net
      FROM gl_journal_lines l
      JOIN gl_journals gj ON gj.id = l.journal_id
      JOIN gl_accounts ga ON ga.id = l.account_id
      JOIN accounts ac ON ac.id = l.tenant_id
      WHERE ga.control_for_kind IS NOT NULL AND gj.currency IN ${CURRENCY_LIST}
      GROUP BY 1, 2
    )
    SELECT COALESCE(s.kind, b.kind) AS kind,
           COALESCE(s.currency, b.currency) AS currency,
           COALESCE(s.net, 0)::text AS subledger_minor,
           COALESCE(b.net, 0)::text AS books_minor,
           (COALESCE(b.net, 0) - COALESCE(s.net, 0))::text AS difference_minor
    FROM subledger s
    FULL OUTER JOIN books b ON b.kind = s.kind AND b.currency = s.currency
    WHERE COALESCE(s.net, 0) <> COALESCE(b.net, 0)
    ORDER BY 1, 2
  `);
  return rows.map((r) => ({
    kind: String(r.kind),
    currency: String(r.currency),
    subledgerMinor: String(r.subledger_minor),
    booksMinor: String(r.books_minor),
    differenceMinor: String(r.difference_minor),
  }));
}

/** Run the reconciliation. Healthy, and demonstrably not blind, => { ok: true, [] }. */
export async function checkGlReconciliation(
  db: SqlExecutor,
): Promise<GlReconciliationResult> {
  const missingTables = await findMissingTables(db);
  if (missingTables.length > 0) {
    return {
      ok: false,
      discrepancies: [],
      unattributedControlLines: 0,
      orphanedControlLines: 0,
      unsupportedSubledgerCurrencies: [],
      coverage: { subledgerLegs: 0, mirrorControlLines: 0, blind: false },
      missingTables,
    };
  }

  const [discrepancies, scanned] = await Promise.all([
    findControlAccountDiscrepancies(db),
    measureCoverage(db),
  ]);

  // Saw nothing while the subledger holds legs — RLS filtering, not agreement.
  // Not "did it find rows" but "could it have". See the header.
  const blind = !scanned.canReadSubledger;

  return {
    ok:
      discrepancies.length === 0 &&
      !blind &&
      scanned.unattributed === 0 &&
      scanned.unsupportedCurrencies.length === 0,
    discrepancies,
    unattributedControlLines: scanned.unattributed,
    orphanedControlLines: scanned.orphaned,
    unsupportedSubledgerCurrencies: scanned.unsupportedCurrencies,
    coverage: {
      subledgerLegs: scanned.subledgerLegs,
      mirrorControlLines: scanned.mirrorControlLines,
      blind,
    },
    missingTables,
  };
}

/** Human-readable report for CI logs / test messages. */
export function formatReconciliation(r: GlReconciliationResult): string {
  const lines: string[] = [];
  for (const t of r.missingTables) {
    lines.push(`✗ table '${t}' not found in DB — migration did not apply?`);
  }
  if (r.coverage.blind) {
    lines.push(
      "✗ reconciliation is BLIND: this caller is neither superuser nor a member of app_provisioner, so RLS hides the subledger from it — any result would be meaningless",
    );
  }
  if (r.unattributedControlLines > 0) {
    lines.push(
      `✗ ${r.unattributedControlLines} control-account line(s) carry no tenant — nothing in phase 1 posts one, so a poster is attributing money to nobody`,
    );
  }
  if (r.unsupportedSubledgerCurrencies.length > 0) {
    lines.push(
      `✗ subledger holds money in unsupported currency/currencies ${r.unsupportedSubledgerCurrencies.join(", ")} — outside what this comparison covers`,
    );
  }
  for (const d of r.discrepancies) {
    lines.push(
      `✗ ${d.kind}/${d.currency}: subledger ${d.subledgerMinor} vs books ${d.booksMinor} (off by ${d.differenceMinor})`,
    );
  }
  if (lines.length === 0) {
    const orphans =
      r.orphanedControlLines > 0
        ? `; ${r.orphanedControlLines} line(s) excluded for a deleted workspace`
        : "";
    return `subledger reconciles to corporate control accounts over ${r.coverage.subledgerLegs} leg(s)${orphans}`;
  }
  return lines.join("\n");
}
