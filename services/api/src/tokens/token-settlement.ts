import type { TenantTx } from "@app/db";
import { resolveTokenHolds } from "./token-holds.js";
import { recognizeTokenAllocation } from "./token-recognition.js";

/**
 * Resolve the entitlement hold and, only for committed delivery, advance each lot's exact cumulative
 * revenue position. A returned hold restores count and leaves deferred revenue untouched.
 */
export async function settleTokenHolds(
  tx: TenantTx,
  referenceId: string,
  outcome: "committed" | "returned",
): Promise<void> {
  const settled = await resolveTokenHolds(tx, referenceId, outcome);
  if (outcome !== "committed") return;

  for (const allocation of settled) {
    await recognizeTokenAllocation(tx, referenceId, allocation);
  }
}
