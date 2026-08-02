import type { TokenReconciliationResult } from "./token-reconciliation.js";

/**
 * Human-readable report for CI logs, `db:assert` output and test messages. Split from the comparison
 * for the file-length guard, exactly as the GL side is.
 *
 * Every line names both sides and the difference, because "entitlement does not reconcile" is not an
 * actionable message: which side is wrong decides whether the fix is a counter repair or a ledger
 * correction, and those are very different operations.
 */
export function formatTokenReconciliation(
  r: TokenReconciliationResult,
): string {
  const lines: string[] = [];
  for (const t of r.missingTables) {
    lines.push(`✗ table '${t}' not found in DB — migration did not apply?`);
  }
  if (r.coverage.blind) {
    lines.push(
      "✗ token reconciliation is BLIND: this caller is neither superuser nor a member of app_provisioner, so RLS hides every token table from it — any result would be meaningless",
    );
  }
  for (const c of r.unsupportedLotCurrencies) {
    lines.push(
      `✗ token lots hold consideration in unsupported currency '${c}' — outside what this comparison covers`,
    );
  }
  for (const e of r.entitlement) {
    lines.push(
      `✗ entitlement ${e.tenantId} ${e.channel}/${e.currency}: counter ${e.counterAvailable} vs lots-minus-holds ${e.derivedAvailable} (off by ${e.differenceUnits})`,
    );
  }
  for (const d of r.deferredRevenue) {
    lines.push(
      `✗ deferred revenue ${d.tenantId}/${d.currency}: ledger ${d.ledgerMinor} vs unearned lot value ${d.unrecognizedLotMinor} (off by ${d.differenceMinor})`,
    );
  }
  for (const a of r.allocationTrail) {
    lines.push(
      `✗ lot ${a.lotId}: consumed ${a.lotConsumed} vs allocations ${a.allocatedQuantity}; recognized ${a.lotRecognizedMinor} vs allocations ${a.allocatedRecognizedMinor}`,
    );
  }
  if (lines.length === 0) {
    return `prepaid credits reconcile: ${r.coverage.lots} lot(s), ${r.coverage.counters} counter(s), ${r.coverage.pendingHolds} pending hold(s), ${r.coverage.allocations} allocation(s)`;
  }
  return lines.join("\n");
}
