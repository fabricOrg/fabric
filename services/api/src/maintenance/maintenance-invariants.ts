import {
  checkGlInvariants,
  checkGlReconciliation,
  checkLedgerInvariants,
  checkTokenReconciliation,
  formatGlViolations,
  formatReconciliation,
  formatTokenReconciliation,
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

    // COM-010: prepaid credits. A FOURTH check rather than part of the reconciliation above, because
    // entitlement can drift while both ledgers stay perfectly balanced — a counter is a projection of
    // counts, not of money, so no double-entry invariant covers it. Runs on the same provisioning
    // connection: every token table is FORCE RLS with a policy naming `app_provisioner`.
    const tokens = await checkTokenReconciliation(executor);
    if (!tokens.ok) {
      input.logger.error(
        `PREPAID CREDIT RECONCILIATION FAILURE
${formatTokenReconciliation(tokens)}`,
      );
    }

    // The subledger result is what existing callers and tests consume; the GL, reconciliation and
    // token results are reported through the log because nothing branches on them yet.
    return subledger;
  });
}
