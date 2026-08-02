import type { SqlExecutor } from "./ledger-invariant.js";

/**
 * COVERAGE PROBE for the token reconciliation (see token-reconciliation.ts) — what it scanned and,
 * more importantly, whether this caller was in a position to see anything at all.
 *
 * Same failure mode as the GL reconciliation's probe, and the same fix. `token_lots`,
 * `token_counters`, `token_holds` and `token_recognition_allocations` are FORCE RLS with
 * `provisioner_all` policies naming `app_provisioner` (0089 / 0091 / 0118). A caller that is neither
 * superuser nor a member of that role reads ZERO rows from every one of them — and an empty
 * comparison finds no discrepancies, so it would report that entitlement reconciles when it had not
 * looked at a single credit.
 *
 * Row counts cannot detect that: RLS filters the count to zero right alongside the data, and "no
 * lots" is also the honest state of a fresh database. So the probe asks about CAPABILITY, which is
 * RLS-immune and independent of how much data exists.
 */
export async function measureTokenCoverage(db: SqlExecutor): Promise<{
  lots: number;
  counters: number;
  pendingHolds: number;
  allocations: number;
  canReadTokens: boolean;
}> {
  const { rows } = await db.query(`
    SELECT
      (SELECT count(*) FROM token_lots)                                  AS lots,
      (SELECT count(*) FROM token_counters)                              AS counters,
      (SELECT count(*) FROM token_holds WHERE status = 'pending')        AS pending_holds,
      (SELECT count(*) FROM token_recognition_allocations)               AS allocations,
      (current_setting('is_superuser') = 'on'
        OR pg_has_role(current_user, 'app_provisioner', 'USAGE'))        AS can_read_tokens
  `);
  const r = rows[0] ?? {};
  return {
    lots: Number(r.lots ?? 0),
    counters: Number(r.counters ?? 0),
    pendingHolds: Number(r.pending_holds ?? 0),
    allocations: Number(r.allocations ?? 0),
    canReadTokens: r.can_read_tokens === true,
  };
}
