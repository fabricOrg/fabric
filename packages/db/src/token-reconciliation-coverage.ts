import type { SqlExecutor } from "./ledger-invariant.js";

export interface TokenCoverage {
  lots: number;
  counters: number;
  pendingHolds: number;
  allocations: number;
  canReadTokens: boolean;
}

/**
 * CAPABILITY PROBE — asked BEFORE any token table is touched.
 *
 * `token_lots`, `token_counters`, `token_holds` and `token_recognition_allocations` are FORCE RLS
 * with `provisioner_all` policies naming `app_provisioner` (0089 / 0091 / 0118), and their grants go
 * to `app_runtime` and `app_provisioner` only. A caller outside both is blind in one of two ways:
 *
 *  - RLS blindness: it holds SELECT, so every scan succeeds and returns ZERO rows. An empty
 *    comparison finds no discrepancies, so the reconciliation would report that entitlement
 *    reconciles having looked at nothing.
 *  - GRANT blindness: it holds no SELECT at all, so the scan RAISES `42501 permission denied`.
 *
 * Only the first was handled before, and the difference between them is table OWNERSHIP, which is
 * environment-dependent (`drizzle-kit migrate` leaves tables owned by whichever role connected).
 * Under grant blindness the probe threw, and because the reconciliation runs inside the scheduled
 * money-correctness transaction alongside the two ledger invariant checks, that exception aborted
 * the whole pass rather than reporting a blind one.
 *
 * So the question asked is CAPABILITY, which no table privilege gates and no RLS policy filters —
 * and it is asked first, so a blind caller never issues a scan it cannot answer for. Reporting blind
 * when the caller could in fact have read is the safe direction; the reverse is the bug.
 *
 * `pg_has_role` RAISES on an unknown role name, so `app_provisioner` is looked up by oid through
 * `pg_roles` and a missing role coalesces to false rather than throwing.
 */
export async function canReadTokenTables(db: SqlExecutor): Promise<boolean> {
  const { rows } = await db.query(`
    SELECT
      (current_setting('is_superuser') = 'on'
        OR COALESCE(
             (SELECT pg_has_role(current_user, r.oid, 'USAGE')
              FROM pg_roles r WHERE r.rolname = 'app_provisioner'),
             false
           )) AS can_read_tokens
  `);
  return rows[0]?.can_read_tokens === true;
}

/**
 * What the reconciliation scanned, and whether this caller was in a position to see anything.
 *
 * Row counts cannot detect blindness on their own: RLS filters the count to zero right alongside the
 * data, and "no lots" is also the honest state of a fresh database. Hence the capability gate above,
 * which short-circuits before a single count is issued.
 */
export async function measureTokenCoverage(
  db: SqlExecutor,
): Promise<TokenCoverage> {
  const canReadTokens = await canReadTokenTables(db);
  if (!canReadTokens) {
    return {
      lots: 0,
      counters: 0,
      pendingHolds: 0,
      allocations: 0,
      canReadTokens: false,
    };
  }
  const { rows } = await db.query(`
    SELECT
      (SELECT count(*) FROM token_lots)                                  AS lots,
      (SELECT count(*) FROM token_counters)                              AS counters,
      (SELECT count(*) FROM token_holds WHERE status = 'pending')        AS pending_holds,
      (SELECT count(*) FROM token_recognition_allocations)               AS allocations
  `);
  const r = rows[0] ?? {};
  return {
    lots: Number(r.lots ?? 0),
    counters: Number(r.counters ?? 0),
    pendingHolds: Number(r.pending_holds ?? 0),
    allocations: Number(r.allocations ?? 0),
    canReadTokens: true,
  };
}
