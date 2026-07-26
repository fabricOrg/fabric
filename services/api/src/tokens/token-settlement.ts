import type { TenantTx } from "@app/db";
import { recognizeTokenConsumption } from "@app/wallet";
import { resolveTokenHolds } from "./token-holds.js";

/**
 * TOKEN SETTLEMENT (ADR-0010 Phase 2, slice 2c-i) — joins the two halves of a token-backed send:
 * the COUNT layer (holds) and the MONEY layer (revenue recognition).
 *
 * Revenue is recognized HERE, on consumption, not at purchase. A purchase only ever credited a
 * liability (`token_deferred_revenue` — we owe N sends); delivering the send is the moment we have
 * actually earned the money, so that is when the liability is discharged into `revenue`.
 *
 * A RETURN recognizes nothing. The tokens go back on the counter and the liability stands, because we
 * still owe the customer those sends.
 *
 * This wrapper is what the engine is handed as `deps.tokens.resolve`, keeping @app/sms-engine free of
 * any dependency on the count layer or the recognition legs.
 */
export async function settleTokenHolds(
  tx: TenantTx,
  referenceId: string,
  outcome: "committed" | "returned",
): Promise<void> {
  // resolveTokenHolds returns ONLY the holds it actually transitioned this call — empty on a repeat —
  // so recognition is driven by real consumption and a duplicate callback recognizes nothing further.
  const settled = await resolveTokenHolds(tx, referenceId, outcome);
  if (outcome !== "committed") return;

  for (const allocation of settled) {
    // The LOT'S LOCKED price, never the current price book: the price-lock is what the purchase
    // bought (ADR-0010 #3). One leg pair per lot, since a send may span lots bought at different
    // prices — which is also why the idempotency key is keyed per (message, lot).
    await recognizeTokenConsumption(tx, {
      currency: allocation.currency,
      amountMinor: allocation.unitPriceMinorLocked * allocation.quantity,
      messageId: referenceId,
      lotId: allocation.lotId,
    });
  }
}
