import { CURRENCY_LIST } from "./gl-currencies.js";
import type { SqlExecutor } from "./ledger-invariant.js";

/**
 * COVERAGE PROBE for the reconciliation (see gl-reconciliation.ts) — what the comparison actually saw,
 * whether it COULD see, and the rows it had to leave out.
 *
 * Split from the comparison itself because it answers a different question: not "do the ledgers agree"
 * but "was this caller in a position to tell". A reconciliation that cannot distinguish those two is
 * worse than none, since it reports success for blindness.
 */

/** What the comparison scanned, plus the rows it had to leave out and why. */
export async function measureCoverage(db: SqlExecutor): Promise<{
  subledgerLegs: number;
  mirrorControlLines: number;
  canReadSubledger: boolean;
  unattributed: number;
  orphaned: number;
  unsupportedCurrencies: string[];
}> {
  const { rows } = await db.query(`
    SELECT
      (SELECT count(*) FROM ledger_entries e
        JOIN ledger_accounts a ON a.id = e.account_id
        JOIN gl_journals gj ON gj.source_kind = 'ledger_txn' AND gj.source_ref = e.txn_id::text
       WHERE a.currency IN ${CURRENCY_LIST})                       AS subledger_legs,
      -- Counted WITHOUT touching any RLS table, which is the whole point: the gl_ tables carry no row
      -- security, so this number is visible to every caller. Comparing it against the subledger scan is
      -- what exposes a caller RLS has blinded; counting ledger_entries would be filtered to zero right
      -- alongside the legs and reveal nothing.
      (SELECT count(*) FROM gl_journal_lines l
        JOIN gl_accounts ga ON ga.id = l.account_id
        JOIN gl_journals gj ON gj.id = l.journal_id
       WHERE ga.control_for_kind IS NOT NULL
         AND gj.source_kind = 'ledger_txn'
         AND gj.currency IN ${CURRENCY_LIST})                      AS mirror_control_lines,
      (SELECT count(*) FROM gl_journal_lines l
        JOIN gl_accounts ga ON ga.id = l.account_id
        JOIN gl_journals gj ON gj.id = l.journal_id
        -- Only journals that MIRROR a real movement. Those must attribute their control-account lines
        -- to that movement's tenant; a hand-written or adjustment journal is under no such obligation,
        -- so counting it here would report test fixtures and future adjustments as defects.
        JOIN ledger_transactions lt ON lt.id::text = gj.source_ref
       WHERE ga.control_for_kind IS NOT NULL
         AND gj.source_kind = 'ledger_txn'
         AND l.tenant_id IS NULL)                                   AS unattributed,
      (SELECT count(*) FROM gl_journal_lines l
        JOIN gl_accounts ga ON ga.id = l.account_id
        LEFT JOIN accounts ac ON ac.id = l.tenant_id
       WHERE ga.control_for_kind IS NOT NULL
         AND l.tenant_id IS NOT NULL AND ac.id IS NULL)            AS orphaned,
      (SELECT COALESCE(array_agg(DISTINCT currency ORDER BY currency), '{}')
         FROM ledger_accounts WHERE currency NOT IN ${CURRENCY_LIST}) AS unsupported,
      -- Can this caller see the subledger at all? The permissive policies on ledger_entries,
      -- ledger_accounts and accounts name app_provisioner only, and a superuser bypasses RLS outright.
      -- Anything else reads zero rows and would otherwise be told the ledgers agree.
      (current_setting('is_superuser') = 'on'
        OR pg_has_role(current_user, 'app_provisioner', 'USAGE'))    AS can_read_subledger
  `);
  const r = rows[0] ?? {};
  return {
    subledgerLegs: Number(r.subledger_legs ?? 0),
    mirrorControlLines: Number(r.mirror_control_lines ?? 0),
    canReadSubledger: r.can_read_subledger === true,
    unattributed: Number(r.unattributed ?? 0),
    orphaned: Number(r.orphaned ?? 0),
    unsupportedCurrencies: ((r.unsupported ?? []) as string[]).map(String),
  };
}
