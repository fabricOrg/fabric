import {
  checkGlInvariants,
  checkGlReconciliation,
  checkLedgerInvariants,
  formatGlViolations,
  formatReconciliation,
  formatViolations,
  type LedgerInvariantResult,
  type ProvisioningDb,
} from "@app/db";
import type { Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";

/**
 * The scheduled money-correctness pass. Runs BOTH ledgers' invariants (ADR-0013 #14): the tenant
 * subledger's trial balance and projection integrity, and the corporate general ledger's trial balance
 * and declared completeness. Two ledgers, two definitions of correct, and an operator needs to know
 * which one broke — so they are checked and reported separately.
 *
 * Extracted from MaintenanceService so that class stays a thin scheduler.
 */
export async function runLedgerInvariants(input: {
  db: ProvisioningDb["db"];
  lockKey: number;
  logger: Logger;
}): Promise<LedgerInvariantResult | null> {
  return input.db.transaction(async (tx) => {
    const lockRows = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(${input.lockKey}) AS locked`,
    )) as Array<{ locked: boolean }>;
    if (lockRows[0]?.locked !== true) return null;

    const executor = {
      query: async (q: string) => ({
        rows: (await tx.execute(sql.raw(q))) as Array<Record<string, unknown>>,
      }),
    };

    const subledger = await checkLedgerInvariants(executor);
    if (!subledger.ok) {
      input.logger.error(
        `LEDGER INVARIANT VIOLATION\n${formatViolations(subledger)}`,
      );
    }

    const generalLedger = await checkGlInvariants(executor);
    if (!generalLedger.ok) {
      input.logger.error(
        `GENERAL LEDGER INVARIANT VIOLATION\n${formatGlViolations(generalLedger)}`,
      );
    }

    // Each ledger being internally consistent does not mean they AGREE — that is this third check, and
    // it is the Phase 1 exit gate (ADR-0013 #15).
    const reconciliation = await checkGlReconciliation(executor);
    if (!reconciliation.ok) {
      input.logger.error(
        `LEDGER RECONCILIATION FAILURE\n${formatReconciliation(reconciliation)}`,
      );
    }

    // The subledger result is what existing callers and tests consume; the GL and reconciliation
    // results are reported through the log because nothing branches on them yet.
    return subledger;
  });
}
