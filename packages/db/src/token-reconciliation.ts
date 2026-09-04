// ============================================================================================
// PREPAID CREDIT RECONCILIATION — roadmap COM-010, and the token half of Phase 7 (token deferred
// revenue vs unrecognized lot value; entitlement counter vs lots and holds).
//
// THREE QUESTIONS, deliberately separate, because they fail for different reasons:
//
//   1. ENTITLEMENT — does the cached `token_counters.available` equal what the lots and holds say the
//      workspace still owns? That counter is the row the send path locks FOR UPDATE to refuse an
//      overdraw, so drift here is the difference between selling credits and giving them away.
//   2. DEFERRED REVENUE — does the ledger's `token_deferred_revenue` balance equal the consideration
//      the lots have not yet earned? This is the money question: cash taken for sends we still owe.
//   3. ALLOCATION TRAIL — does each lot's cumulative position equal the sum of its append-only
//      allocation rows? The lot holds a running total for serialization; the rows are the evidence.
//      If they disagree, one of them is fiction, and the CHECK constraints cannot tell which.
//
// UNLIKE THE GL RECONCILIATION, THIS COMPARES WITH NO LAG SCOPE. There, the drain posts to the books
// asynchronously, so the subledger side had to be narrowed to movements already posted or normal lag
// would read as a discrepancy. Here every pair being compared is written in ONE tenant transaction —
// `grantTokensForPurchase` posts the purchase movement and inserts the lot together;
// `recognizeTokenAllocation` posts the consumption movement, advances the lot and writes the
// allocation row together; expiry recognizes breakage and stamps the lot together. So equality is
// exact at every instant a reader can observe, and anything else is a real defect rather than timing.
//
// WHY THE COUNTER FORMULA IS `total - consumed - expired - pending`, and why it is not a redundant
// restatement of the code: `holdTokens` decrements `available` when a hold is created and only
// re-increments it on RETURN, while commit instead advances `quantity_consumed`. So a committed hold
// must NOT be subtracted twice, and a pending one must be subtracted exactly once. Getting that wrong
// in either direction is invisible in any single test — it only shows as slow drift on a live account,
// which is exactly what this check exists to catch.
//
// "NO DISCREPANCIES" IS NOT "AGREEMENT": every token table is FORCE RLS, so a caller RLS has blinded
// finds nothing wrong because it sees nothing at all. See token-reconciliation-coverage.ts.
// ============================================================================================

import type { SqlExecutor } from "./ledger-invariant.js";
import {
  canReadTokenTables,
  measureTokenCoverage,
} from "./token-reconciliation-coverage.js";
import {
  findAllocationTrailDiscrepancies,
  findDeferredRevenueDiscrepancies,
  findEntitlementDiscrepancies,
  findUnsupportedLotCurrencies,
} from "./token-reconciliation-queries.js";

/** A workspace whose spendable counter disagrees with its lots and holds. */
export interface EntitlementDiscrepancy {
  tenantId: string;
  channel: string;
  currency: string;
  /** `token_counters.available` — the cached projection the send path gates on. */
  counterAvailable: string;
  /** Σ (quantity_total − quantity_consumed − quantity_expired) − Σ pending hold quantities. */
  derivedAvailable: string;
  /** counter − derived. Non-zero is the defect. */
  differenceUnits: string;
}

/** A workspace whose deferred-revenue liability disagrees with its unearned lot consideration. */
export interface DeferredRevenueDiscrepancy {
  tenantId: string;
  currency: string;
  /** Σ credits − Σ debits on the `token_deferred_revenue` account. */
  ledgerMinor: string;
  /** Σ (total_price_minor_locked − revenue_recognized_minor − breakage_recognized_minor). */
  unrecognizedLotMinor: string;
  /** ledger − lots. Non-zero is the defect. */
  differenceMinor: string;
}

/** A lot whose running position disagrees with its own append-only allocation rows. */
export interface AllocationTrailDiscrepancy {
  lotId: string;
  tenantId: string;
  /** `token_lots.quantity_consumed` vs Σ allocation quantities. */
  lotConsumed: string;
  allocatedQuantity: string;
  /** `token_lots.revenue_recognized_minor` vs Σ allocation recognition amounts. */
  lotRecognizedMinor: string;
  allocatedRecognizedMinor: string;
}

export interface TokenReconciliationResult {
  ok: boolean;
  entitlement: EntitlementDiscrepancy[];
  deferredRevenue: DeferredRevenueDiscrepancy[];
  allocationTrail: AllocationTrailDiscrepancy[];
  /** Lot money outside the enabled currency set — credits the comparison could not have covered. */
  unsupportedLotCurrencies: string[];
  coverage: {
    lots: number;
    counters: number;
    pendingHolds: number;
    allocations: number;
    /** RLS hid the token tables from this caller; no result it produces means anything. */
    blind: boolean;
  };
  missingTables: string[];
}

const REQUIRED_TABLES = [
  "token_lots",
  "token_counters",
  "token_holds",
  "token_recognition_allocations",
  "ledger_entries",
  "ledger_accounts",
] as const;

async function findMissingTables(db: SqlExecutor): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT ${REQUIRED_TABLES.map(
      (t) => `to_regclass('public.${t}') IS NOT NULL AS "${t}"`,
    ).join(", ")}`,
  );
  const present = rows[0] ?? {};
  return REQUIRED_TABLES.filter((t) => present[t] !== true);
}

/** Run all three comparisons. Healthy, and demonstrably not blind, => { ok: true }. */
export async function checkTokenReconciliation(
  db: SqlExecutor,
): Promise<TokenReconciliationResult> {
  const missingTables = await findMissingTables(db);
  if (missingTables.length > 0) {
    return {
      ok: false,
      entitlement: [],
      deferredRevenue: [],
      allocationTrail: [],
      unsupportedLotCurrencies: [],
      coverage: {
        lots: 0,
        counters: 0,
        pendingHolds: 0,
        allocations: 0,
        blind: false,
      },
      missingTables,
    };
  }

  // Capability BEFORE any scan. The four comparisons below read the same FORCE-RLS token tables as
  // the coverage probe, so a caller without SELECT on them raises `42501 permission denied` here —
  // and this runs inside the scheduled money-correctness transaction, where a throw aborts the
  // ledger invariant pass too. Report blindness; do not discover it by crashing.
  if (!(await canReadTokenTables(db))) {
    return {
      ok: false,
      entitlement: [],
      deferredRevenue: [],
      allocationTrail: [],
      unsupportedLotCurrencies: [],
      coverage: {
        lots: 0,
        counters: 0,
        pendingHolds: 0,
        allocations: 0,
        blind: true,
      },
      missingTables,
    };
  }

  const [entitlement, deferredRevenue, allocationTrail, unsupported, scanned] =
    await Promise.all([
      findEntitlementDiscrepancies(db),
      findDeferredRevenueDiscrepancies(db),
      findAllocationTrailDiscrepancies(db),
      findUnsupportedLotCurrencies(db),
      measureTokenCoverage(db),
    ]);

  const blind = !scanned.canReadTokens;
  return {
    ok:
      entitlement.length === 0 &&
      deferredRevenue.length === 0 &&
      allocationTrail.length === 0 &&
      unsupported.length === 0 &&
      !blind,
    entitlement,
    deferredRevenue,
    allocationTrail,
    unsupportedLotCurrencies: unsupported,
    coverage: {
      lots: scanned.lots,
      counters: scanned.counters,
      pendingHolds: scanned.pendingHolds,
      allocations: scanned.allocations,
      blind,
    },
    missingTables,
  };
}
