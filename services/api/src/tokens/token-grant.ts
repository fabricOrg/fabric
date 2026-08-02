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

export interface TokenExpiryGroup {
  /** ISO timestamp, or null for credits that never lapse. */
  expiresAt: string | null;
  available: string;
}

export async function listTokenBalances(tx: TenantTx): Promise<
  {
    channel: string;
    currency: string;
    available: string;
    expiresNextAt: string | null;
    expiryGroups: TokenExpiryGroup[];
    /** Everything ever granted on this counter, including lots since spent or expired. */
    grantedTotal: string;
    /** Actually SPENT. Deliberately not `granted - available`: expiry also removes credits, and
     *  calling forfeited breakage "used" would overstate what the workspace got for its money. */
    consumedTotal: string;
  }[]
> {
  await expireTokenLots(tx);
  // A counter is ONE number per (channel, currency), so `expires_next_at` alone reports the soonest
  // date across everything it holds — which reads as "all of it lapses then" for a workspace holding
  // a dated package and a permanent one at once.
  //
  // The breakdown below goes back to the lots and groups them BY EXPIRY, rather than splitting into
  // "expiring" and "permanent". Nothing about it is channel-specific, and it does not assume there
  // are only two kinds: three packages with three different dates produce three groups.
  //
  // A lot's spendable remainder is `total - consumed - pending holds`, because a hold leaves the
  // counter at reserve time but does not touch `quantity_consumed` until the send commits — summing
  // without it would over-report mid-flight. Groups therefore reconcile to `available`.
  const rows = (await tx`
    SELECT c.channel, c.currency, c.available::text AS available,
      (
        SELECT MIN(l.expires_at) FROM token_lots l
        WHERE l.tenant_id = c.tenant_id AND l.channel = c.channel
          AND l.currency = c.currency AND l.expires_at IS NOT NULL
          AND l.expiry_processed_at IS NULL
          AND l.quantity_consumed < l.quantity_total
      ) AS expires_next_at,
      COALESCE((
        SELECT json_agg(
                 json_build_object(
                   'expires_at', g.expires_at,
                   'available', g.available::text
                 ) ORDER BY g.expires_at ASC NULLS LAST
               )
        FROM (
          SELECT l.expires_at,
                 SUM(l.quantity_total - l.quantity_consumed - COALESCE(h.held, 0)) AS available
          FROM token_lots l
          LEFT JOIN LATERAL (
            SELECT SUM(th.quantity) AS held FROM token_holds th
            WHERE th.lot_id = l.id AND th.status = 'pending'
          ) h ON TRUE
          WHERE l.tenant_id = c.tenant_id AND l.channel = c.channel
            AND l.currency = c.currency
            AND (l.expires_at IS NULL OR l.expiry_processed_at IS NULL)
            AND l.quantity_consumed < l.quantity_total
          GROUP BY l.expires_at
          HAVING SUM(l.quantity_total - l.quantity_consumed - COALESCE(h.held, 0)) > 0
        ) g
      ), '[]'::json) AS expiry_groups,
      COALESCE((
        SELECT SUM(l.quantity_total) FROM token_lots l
        WHERE l.tenant_id = c.tenant_id AND l.channel = c.channel
          AND l.currency = c.currency
      ), 0)::text AS granted_total,
      COALESCE((
        SELECT SUM(l.quantity_consumed) FROM token_lots l
        WHERE l.tenant_id = c.tenant_id AND l.channel = c.channel
          AND l.currency = c.currency
      ), 0)::text AS consumed_total
    FROM token_counters c
    WHERE c.tenant_id = current_setting('app.tenant_id')::uuid AND c.available > 0
    ORDER BY c.channel, c.currency`) as {
    channel: string;
    currency: string;
    available: string;
    expires_next_at: Date | string | null;
    expiry_groups: { expires_at: string | null; available: string }[];
    granted_total: string;
    consumed_total: string;
  }[];
  return rows.map((row) => ({
    channel: String(row.channel),
    currency: String(row.currency),
    available: String(row.available),
    expiresNextAt:
      row.expires_next_at === null
        ? null
        : new Date(row.expires_next_at).toISOString(),
    expiryGroups: (row.expiry_groups ?? []).map((group) => ({
      expiresAt:
        group.expires_at === null
          ? null
          : new Date(group.expires_at).toISOString(),
      available: String(group.available),
    })),
    grantedTotal: String(row.granted_total),
    consumedTotal: String(row.consumed_total),
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
