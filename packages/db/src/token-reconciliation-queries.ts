import { CURRENCY_LIST } from "./gl-currencies.js";
import type { SqlExecutor } from "./ledger-invariant.js";
import type {
  AllocationTrailDiscrepancy,
  DeferredRevenueDiscrepancy,
  EntitlementDiscrepancy,
} from "./token-reconciliation.js";

/**
 * The three comparison queries behind the prepaid-credit reconciliation. Split from the orchestrator
 * for the file-length guard; the reasoning for each comparison lives in token-reconciliation.ts.
 */

// Σ credits − Σ debits, the shared sign convention (ADR-0013 #7).
const SIGNED_LEDGER =
  "CASE e.direction WHEN 'credit' THEN e.amount_minor ELSE -e.amount_minor END";

/**
 * Counter vs lots-and-holds, per (tenant, channel, currency).
 *
 * A FULL OUTER JOIN in both directions on purpose: a counter row with no surviving lots is as much a
 * defect as lots with no counter, and the second one is worse — it means a workspace holds credits the
 * send path cannot see, so it would be told to top up while its entitlement sat unspendable.
 *
 * Pending holds are aggregated separately rather than joined into the lot scan: a lot can carry many
 * holds, and joining would multiply its quantity by the hold count.
 */
export async function findEntitlementDiscrepancies(
  db: SqlExecutor,
): Promise<EntitlementDiscrepancy[]> {
  const { rows } = await db.query(`
    WITH derived AS (
      SELECT l.tenant_id, l.channel, l.currency,
             SUM(l.quantity_total - l.quantity_consumed - l.quantity_expired)
               - COALESCE(SUM(h.pending), 0) AS available
      FROM token_lots l
      LEFT JOIN LATERAL (
        SELECT SUM(th.quantity) AS pending
        FROM token_holds th
        WHERE th.lot_id = l.id AND th.status = 'pending'
      ) h ON TRUE
      GROUP BY 1, 2, 3
    )
    SELECT COALESCE(c.tenant_id, d.tenant_id)::text AS tenant_id,
           COALESCE(c.channel, d.channel) AS channel,
           COALESCE(c.currency, d.currency) AS currency,
           COALESCE(c.available, 0)::text AS counter_available,
           COALESCE(d.available, 0)::text AS derived_available,
           (COALESCE(c.available, 0) - COALESCE(d.available, 0))::text AS difference_units
    FROM token_counters c
    FULL OUTER JOIN derived d
      ON d.tenant_id = c.tenant_id AND d.channel = c.channel
     AND d.currency = c.currency
    WHERE COALESCE(c.available, 0) <> COALESCE(d.available, 0)
    ORDER BY 1, 2, 3
  `);
  return rows.map((r) => ({
    tenantId: String(r.tenant_id),
    channel: String(r.channel),
    currency: String(r.currency),
    counterAvailable: String(r.counter_available),
    derivedAvailable: String(r.derived_available),
    differenceUnits: String(r.difference_units),
  }));
}

/**
 * The ledger liability vs unearned lot consideration, per (tenant, currency).
 *
 * The ledger side sums `ledger_entries` rather than reading `ledger_accounts.balance_minor`, so this
 * does not inherit the cached projection's correctness as an assumption — that projection has its own
 * invariant in ledger-invariant.ts, and a reconciliation that leaned on it would report agreement
 * whenever both it and the counter drifted together.
 *
 * Lots aggregate across channels here because the ledger account is per (tenant, currency): a
 * workspace holds ONE deferred-revenue account covering every channel it bought.
 */
export async function findDeferredRevenueDiscrepancies(
  db: SqlExecutor,
): Promise<DeferredRevenueDiscrepancy[]> {
  const { rows } = await db.query(`
    WITH ledger AS (
      SELECT a.tenant_id, a.currency, SUM(${SIGNED_LEDGER}) AS net
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      WHERE a.kind = 'token_deferred_revenue' AND a.currency IN ${CURRENCY_LIST}
      GROUP BY 1, 2
    ),
    lots AS (
      SELECT l.tenant_id, l.currency,
             SUM(l.total_price_minor_locked - l.revenue_recognized_minor
                 - l.breakage_recognized_minor) AS unrecognized
      FROM token_lots l
      WHERE l.currency IN ${CURRENCY_LIST}
      GROUP BY 1, 2
    )
    SELECT COALESCE(g.tenant_id, t.tenant_id)::text AS tenant_id,
           COALESCE(g.currency, t.currency) AS currency,
           COALESCE(g.net, 0)::text AS ledger_minor,
           COALESCE(t.unrecognized, 0)::text AS unrecognized_lot_minor,
           (COALESCE(g.net, 0) - COALESCE(t.unrecognized, 0))::text AS difference_minor
    FROM ledger g
    FULL OUTER JOIN lots t
      ON t.tenant_id = g.tenant_id AND t.currency = g.currency
    WHERE COALESCE(g.net, 0) <> COALESCE(t.unrecognized, 0)
    ORDER BY 1, 2
  `);
  return rows.map((r) => ({
    tenantId: String(r.tenant_id),
    currency: String(r.currency),
    ledgerMinor: String(r.ledger_minor),
    unrecognizedLotMinor: String(r.unrecognized_lot_minor),
    differenceMinor: String(r.difference_minor),
  }));
}

/**
 * Each lot's running position vs the sum of its allocation rows.
 *
 * Breakage is deliberately absent from this comparison: expiry advances `quantity_expired` and
 * `breakage_recognized_minor` and writes NO allocation row, because nothing was consumed. Including
 * it would report every expired lot as a defect.
 */
export async function findAllocationTrailDiscrepancies(
  db: SqlExecutor,
): Promise<AllocationTrailDiscrepancy[]> {
  const { rows } = await db.query(`
    SELECT l.id::text AS lot_id, l.tenant_id::text AS tenant_id,
           l.quantity_consumed::text AS lot_consumed,
           COALESCE(a.quantity, 0)::text AS allocated_quantity,
           l.revenue_recognized_minor::text AS lot_recognized_minor,
           COALESCE(a.recognized, 0)::text AS allocated_recognized_minor
    FROM token_lots l
    LEFT JOIN LATERAL (
      SELECT SUM(ra.quantity) AS quantity, SUM(ra.recognition_minor) AS recognized
      FROM token_recognition_allocations ra
      WHERE ra.lot_id = l.id
    ) a ON TRUE
    WHERE l.quantity_consumed <> COALESCE(a.quantity, 0)
       OR l.revenue_recognized_minor <> COALESCE(a.recognized, 0)
    ORDER BY 1
  `);
  return rows.map((r) => ({
    lotId: String(r.lot_id),
    tenantId: String(r.tenant_id),
    lotConsumed: String(r.lot_consumed),
    allocatedQuantity: String(r.allocated_quantity),
    lotRecognizedMinor: String(r.lot_recognized_minor),
    allocatedRecognizedMinor: String(r.allocated_recognized_minor),
  }));
}

/** Lot currencies outside the enabled set — credits this comparison could not have covered. */
export async function findUnsupportedLotCurrencies(
  db: SqlExecutor,
): Promise<string[]> {
  const { rows } = await db.query(`
    SELECT COALESCE(array_agg(DISTINCT currency ORDER BY currency), '{}') AS unsupported
    FROM token_lots WHERE currency NOT IN ${CURRENCY_LIST}
  `);
  return ((rows[0]?.unsupported ?? []) as string[]).map(String);
}
