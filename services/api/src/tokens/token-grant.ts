import {
  type AppDb,
  type ProvisioningDb,
  type TenantTx,
  tokenPurchases,
} from "@app/db";
import { creditTokenPurchase } from "@app/wallet";
import { eq } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";

/**
 * TOKEN GRANT (ADR-0010 Phase 2, slice 2a) — turn a CLEARED token purchase into an entitlement:
 * one tenant transaction that posts the deferred-revenue money leg, appends the price-locked lot, and
 * raises the spendable counter.
 *
 * SECURITY — the grant reads the stored intent ITSELF rather than accepting quantity/price from its
 * caller. That is deliberate: the provider webhook is attacker-reachable, so if the numbers could be
 * passed in, a forged payload could inflate a grant. Reading them here makes that impossible by
 * construction, and the `token_purchases_amount_chk` CHECK already ties the charged amount to
 * quantity × locked price. The caller still owes the signature check and the amount/currency
 * reconciliation against the intent, exactly as `PaymentsService.handleWebhook` does for top-ups.
 *
 * NOT YET CALLED IN PRODUCTION. Tokens are not spendable until the send path consumes them (slice
 * 2b), so no purchase endpoint is exposed — selling a send we cannot deliver would be dishonest. The
 * production caller (initiate + the Paystack webhook branch) lands with slice 2c.
 */

export interface TokenGrantResult {
  /** false when the purchase was already granted — a replayed webhook moves nothing. */
  readonly granted: boolean;
  readonly lotId: string;
  readonly txnId: string;
  readonly quantity: bigint;
}

export interface TokenGrantDeps {
  readonly provisioning: ProvisioningDb;
  readonly appDb: AppDb;
}

/**
 * Grant the tokens bought by `reference`. IDEMPOTENT end to end: the ledger movement dedupes on the
 * reference, the lot insert dedupes on `uniq_token_lot_purchase`, and the counter is raised ONLY when
 * the lot row was actually inserted this call — so a duplicate callback+webhook grants exactly once.
 */
export async function grantTokensForPurchase(
  deps: TokenGrantDeps,
  reference: string,
): Promise<TokenGrantResult> {
  // The intent is platform-level (the webhook carries no tenant context), so it is read on the
  // provisioning connection — mirroring PaymentsService's top-up lookup.
  const [purchase] = await deps.provisioning.db
    .select()
    .from(tokenPurchases)
    .where(eq(tokenPurchases.reference, reference))
    .limit(1);
  if (!purchase) {
    throw notFound("token_purchase_not_found", "Unknown token purchase.");
  }
  if (purchase.status === "failed") {
    // Fail closed: a purchase we already rejected must never later mint an entitlement.
    throw invalidRequest(
      "token_purchase_failed",
      "This token purchase was not completed.",
    );
  }

  return deps.appDb.withTenant(purchase.tenantId, async (tx) => {
    // 1. Money: cash in against the token liability. Idempotent on the purchase reference.
    const movement = await creditTokenPurchase(tx, {
      currency: purchase.currency,
      amountMinor: purchase.amountMinor,
      idempotencyKey: purchase.reference,
      purchaseId: purchase.id,
    });

    // 2. Entitlement: append the price-locked lot. ON CONFLICT DO NOTHING is the grant-once gate —
    // an empty RETURNING means this purchase was already granted.
    const inserted = (await tx`
      INSERT INTO token_lots (
        tenant_id, channel, currency, quantity_total, unit_price_minor_locked,
        purchase_reference, purchase_txn_id
      )
      VALUES (
        current_setting('app.tenant_id')::uuid, ${purchase.channel}, ${purchase.currency},
        ${purchase.quantity.toString()}::bigint, ${purchase.unitPriceMinorLocked.toString()}::bigint,
        ${purchase.reference}, ${movement.txnId}
      )
      ON CONFLICT (tenant_id, purchase_reference) DO NOTHING
      RETURNING id`) as { id: string }[];

    const lotRow = inserted[0];
    if (!lotRow) {
      // Replay: the lot already exists. Return its id and leave the counter alone — raising it here
      // is exactly the double-grant bug the ON CONFLICT gate exists to prevent.
      const existing = (await tx`
        SELECT id FROM token_lots
        WHERE tenant_id = current_setting('app.tenant_id')::uuid
          AND purchase_reference = ${purchase.reference}`) as { id: string }[];
      return {
        granted: false,
        lotId: String(existing[0]?.id ?? ""),
        txnId: movement.txnId,
        quantity: purchase.quantity,
      };
    }

    // 3. Projection: raise the spendable counter for (channel, currency). Only reached when the lot
    // was genuinely inserted, so the counter can never run ahead of the lots backing it.
    await tx`
      INSERT INTO token_counters (tenant_id, channel, currency, available)
      VALUES (
        current_setting('app.tenant_id')::uuid, ${purchase.channel}, ${purchase.currency},
        ${purchase.quantity.toString()}::bigint
      )
      ON CONFLICT (tenant_id, channel, currency) DO UPDATE
        SET available = token_counters.available + EXCLUDED.available, updated_at = now()`;

    return {
      granted: true,
      lotId: lotRow.id,
      txnId: movement.txnId,
      quantity: purchase.quantity,
    };
  });
}

/**
 * The tenant's spendable token count for a (channel, currency). Reads the projection row the send
 * path will lock in slice 2b; returns 0 when no counter exists yet.
 */
export async function readTokenBalance(
  tx: TenantTx,
  channel: string,
  currency: string,
): Promise<bigint> {
  const rows = (await tx`
    SELECT available FROM token_counters
    WHERE tenant_id = current_setting('app.tenant_id')::uuid
      AND channel = ${channel} AND currency = ${currency}`) as {
    available: string;
  }[];
  return BigInt(String(rows[0]?.available ?? "0"));
}
