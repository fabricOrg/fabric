import {
  type AppDb,
  type ProvisioningDb,
  type TenantTx,
  tokenPurchases,
} from "@app/db";
import { creditTokenPurchase } from "@app/wallet";
import { eq } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";
import { expireTokenLots } from "./token-expiry.js";

export interface TokenGrantResult {
  /** False when every package item already existed, so a replay moved no entitlement. */
  readonly granted: boolean;
  readonly txnId: string;
  readonly lots: readonly {
    lotId: string;
    channel: string;
    quantity: bigint;
  }[];
}

export interface TokenGrantDeps {
  readonly provisioning: ProvisioningDb;
  readonly appDb: AppDb;
}

/**
 * Grant the stored purchase promise. The one tenant transaction posts cash to deferred revenue,
 * creates one lot per package item, and raises each channel projection. The stable
 * (purchase, channel) key makes a webhook replay idempotent per item.
 */
export async function grantTokensForPurchase(
  deps: TokenGrantDeps,
  reference: string,
): Promise<TokenGrantResult> {
  const [purchase] = await deps.provisioning.db
    .select()
    .from(tokenPurchases)
    .where(eq(tokenPurchases.reference, reference))
    .limit(1);
  if (!purchase) {
    throw notFound("token_purchase_not_found", "Unknown token purchase.");
  }
  if (purchase.status === "failed") {
    throw invalidRequest(
      "token_purchase_failed",
      "This token purchase was not completed.",
    );
  }
  const { offerVersionId, offerSnapshot, packCount: purchasedPacks } = purchase;
  if (
    !offerVersionId ||
    !offerSnapshot ||
    purchasedPacks === null ||
    offerSnapshot.items.length === 0
  ) {
    throw invalidRequest(
      "token_purchase_snapshot_invalid",
      "The stored package purchase is incomplete.",
    );
  }

  return deps.appDb.withTenant(purchase.tenantId, async (tx) => {
    const movement = await creditTokenPurchase(tx, {
      currency: purchase.currency,
      amountMinor: purchase.amountMinor,
      idempotencyKey: purchase.reference,
      purchaseId: purchase.id,
    });
    const packCount = BigInt(purchasedPacks);
    const lots = offerSnapshot.items.map((item) => ({
      channel: item.channelCode,
      quantity: BigInt(item.totalUnits) * packCount,
      itemId: item.itemId,
      snapshot: JSON.stringify(item),
      totalPriceMinor: BigInt(item.allocatedPriceMinor) * packCount,
    }));
    const allocatedTotal = lots.reduce(
      (sum, lot) => sum + lot.totalPriceMinor,
      0n,
    );
    if (allocatedTotal !== purchase.amountMinor) {
      throw invalidRequest(
        "token_purchase_snapshot_invalid",
        "The package allocations do not reconcile to its charged amount.",
      );
    }

    const validityDays = offerSnapshot.creditValidityDays;
    // Bound as an ISO string with an explicit cast: the driver cannot serialize a bare Date into an
    // untyped parameter slot. Millisecond precision is enough here — unlike a keyset cursor, nothing
    // compares this for equality.
    const expiresAt = validityDays
      ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1_000).toISOString()
      : null;
    const grantedLots: Array<{
      lotId: string;
      channel: string;
      quantity: bigint;
    }> = [];
    let insertedAny = false;
    for (const lot of lots) {
      const inserted = (await tx`
        INSERT INTO token_lots (
          tenant_id, channel, currency, offer_version_id,
          offer_version_item_id, compatibility_snapshot, quantity_total,
          total_price_minor_locked, purchase_reference,
          purchase_txn_id, expires_at
        ) VALUES (
          current_setting('app.tenant_id')::uuid, ${lot.channel}, ${purchase.currency},
          ${offerVersionId}, ${lot.itemId},
          ${lot.snapshot}::jsonb, ${lot.quantity.toString()}::bigint,
          ${lot.totalPriceMinor.toString()}::bigint,
          ${purchase.reference}, ${movement.txnId}, ${expiresAt}::timestamptz
        )
        ON CONFLICT (tenant_id, purchase_reference, channel) DO NOTHING
        RETURNING id`) as unknown as { id: string }[];
      const insertedLot = inserted[0];
      if (insertedLot) {
        insertedAny = true;
        await tx`
          INSERT INTO token_counters (tenant_id, channel, currency, available)
          VALUES (
            current_setting('app.tenant_id')::uuid, ${lot.channel}, ${purchase.currency},
            ${lot.quantity.toString()}::bigint
          )
          ON CONFLICT (tenant_id, channel, currency) DO UPDATE
            SET available = token_counters.available + EXCLUDED.available, updated_at = now()`;
        grantedLots.push({
          lotId: insertedLot.id,
          channel: lot.channel,
          quantity: lot.quantity,
        });
        continue;
      }
      const existing = (await tx`
        SELECT id FROM token_lots
        WHERE tenant_id = current_setting('app.tenant_id')::uuid
          AND purchase_reference = ${purchase.reference}
          AND channel = ${lot.channel}`) as { id: string }[];
      grantedLots.push({
        lotId: String(existing[0]?.id ?? ""),
        channel: lot.channel,
        quantity: lot.quantity,
      });
    }
    return { granted: insertedAny, txnId: movement.txnId, lots: grantedLots };
  });
}

export async function listTokenBalances(tx: TenantTx): Promise<
  {
    channel: string;
    currency: string;
    available: string;
    expiresNextAt: string | null;
  }[]
> {
  await expireTokenLots(tx);
  // The soonest unspent expiry per counter, so the balance can name the date checkout promised.
  // Exhausted and already-processed lots carry nothing further to lose.
  const rows = (await tx`
    SELECT c.channel, c.currency, c.available::text AS available,
      (
        SELECT MIN(l.expires_at) FROM token_lots l
        WHERE l.tenant_id = c.tenant_id AND l.channel = c.channel
          AND l.currency = c.currency AND l.expires_at IS NOT NULL
          AND l.expiry_processed_at IS NULL
          AND l.quantity_consumed < l.quantity_total
      ) AS expires_next_at
    FROM token_counters c
    WHERE c.tenant_id = current_setting('app.tenant_id')::uuid AND c.available > 0
    ORDER BY c.channel, c.currency`) as {
    channel: string;
    currency: string;
    available: string;
    expires_next_at: Date | string | null;
  }[];
  return rows.map((row) => ({
    channel: String(row.channel),
    currency: String(row.currency),
    available: String(row.available),
    expiresNextAt:
      row.expires_next_at === null
        ? null
        : new Date(row.expires_next_at).toISOString(),
  }));
}

export async function readTokenBalance(
  tx: TenantTx,
  channel: string,
  currency: string,
): Promise<bigint> {
  await expireTokenLots(tx, { channel, currency });
  const rows = (await tx`
    SELECT available FROM token_counters
    WHERE tenant_id = current_setting('app.tenant_id')::uuid
      AND channel = ${channel} AND currency = ${currency}`) as {
    available: string;
  }[];
  return BigInt(String(rows[0]?.available ?? "0"));
}
