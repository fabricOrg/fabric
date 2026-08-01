import type { TenantTx } from "@app/db";
import { recognizeTokenBreakage } from "@app/wallet";

interface ExpiredLotRow {
  id: string;
  channel: string;
  currency: string;
  quantity_total: string;
  quantity_consumed: string;
  total_price_minor_locked: string;
  revenue_recognized_minor: string;
}

/**
 * Lazily close expired lots inside the caller's tenant transaction. Pending sends defer expiry so a
 * credit cannot expire underneath an in-flight delivery; its terminal resolver makes the next pass
 * eligible. Row locks and expiry_processed_at make concurrent API and scheduler passes idempotent.
 */
export async function expireTokenLots(
  tx: TenantTx,
  filter: { channel?: string; currency?: string } = {},
): Promise<number> {
  const rows = (await tx`
    SELECT l.id, l.channel, l.currency, l.quantity_total,
      l.quantity_consumed, l.total_price_minor_locked,
      l.revenue_recognized_minor
    FROM token_lots l
    WHERE l.tenant_id = current_setting('app.tenant_id')::uuid
      AND l.expires_at <= now() AND l.expiry_processed_at IS NULL
      AND (${filter.channel ?? null}::text IS NULL OR l.channel = ${filter.channel ?? null})
      AND (${filter.currency ?? null}::text IS NULL OR l.currency = ${filter.currency ?? null})
      AND NOT EXISTS (
        SELECT 1 FROM token_holds h WHERE h.lot_id = l.id AND h.status = 'pending'
      )
    ORDER BY l.expires_at, l.created_at
    FOR UPDATE OF l`) as ExpiredLotRow[];

  for (const lot of rows) {
    const total = BigInt(lot.quantity_total);
    const consumed = BigInt(lot.quantity_consumed);
    const expired = total - consumed;
    const recognized = BigInt(lot.revenue_recognized_minor);
    // Whatever consideration this lot never earned becomes breakage.
    const breakage = BigInt(lot.total_price_minor_locked) - recognized;
    if (breakage > 0n) {
      await recognizeTokenBreakage(tx, {
        currency: lot.currency,
        amountMinor: breakage,
        lotId: lot.id,
      });
    }
    if (expired > 0n) {
      await tx`
        UPDATE token_counters
        SET available = available - ${expired.toString()}::bigint, updated_at = now()
        WHERE tenant_id = current_setting('app.tenant_id')::uuid
          AND channel = ${lot.channel} AND currency = ${lot.currency}`;
    }
    await tx`
      UPDATE token_lots
      SET quantity_expired = ${expired.toString()}::bigint,
          breakage_recognized_minor = ${breakage.toString()}::bigint,
          expiry_processed_at = now(), updated_at = now()
      WHERE tenant_id = current_setting('app.tenant_id')::uuid AND id = ${lot.id}`;
  }
  return rows.length;
}
