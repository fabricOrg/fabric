import type { TenantTx } from "@app/db";
import { allocateCommercialOfferRecognition } from "@app/domain";
import { recognizeTokenConsumption } from "@app/wallet";
import type { TokenHoldAllocation } from "./token-holds.js";

interface LotRow {
  readonly pricing_model: string;
  readonly quantity_total: string;
  readonly quantity_consumed: string;
  readonly unit_price_minor_locked: string | null;
  readonly total_price_minor_locked: string | null;
  readonly revenue_recognized_minor: string;
}

/** Advance one lot's entitlement and revenue positions as one tenant transaction. */
export async function recognizeTokenAllocation(
  tx: TenantTx,
  referenceId: string,
  allocation: TokenHoldAllocation,
): Promise<void> {
  const alreadyAllocated = (await tx`
    SELECT 1 FROM token_recognition_allocations
    WHERE tenant_id = current_setting('app.tenant_id')::uuid
      AND hold_id = ${allocation.holdId}
    LIMIT 1`) as unknown as readonly unknown[];
  if (alreadyAllocated.length > 0) return;

  const rows = (await tx`
    SELECT pricing_model, quantity_total, quantity_consumed,
      unit_price_minor_locked, total_price_minor_locked, revenue_recognized_minor
    FROM token_lots
    WHERE tenant_id = current_setting('app.tenant_id')::uuid
      AND id = ${allocation.lotId}
    FOR UPDATE`) as LotRow[];
  const lot = rows[0];
  if (!lot) throw new Error("Token recognition lot was not found.");

  const totalUnits = BigInt(lot.quantity_total);
  const consumedBefore = BigInt(lot.quantity_consumed);
  const consumedAfter = consumedBefore + allocation.quantity;
  if (consumedAfter > totalUnits) {
    throw new Error("Token recognition would exceed the lot quantity.");
  }
  const recognizedBefore = BigInt(lot.revenue_recognized_minor);
  const recognitionMinor = recognitionForLot(lot, {
    totalUnits,
    consumedBefore,
    quantity: allocation.quantity,
  });
  const recognizedAfter = recognizedBefore + recognitionMinor;

  let ledgerTxnId: string | null = null;
  if (recognitionMinor > 0n) {
    const movement = await recognizeTokenConsumption(tx, {
      currency: allocation.currency,
      amountMinor: recognitionMinor,
      messageId: referenceId,
      lotId: allocation.lotId,
    });
    ledgerTxnId = movement.txnId;
  }

  await tx`
    UPDATE token_lots
    SET quantity_consumed = ${consumedAfter.toString()}::bigint,
        revenue_recognized_minor = ${recognizedAfter.toString()}::bigint,
        updated_at = now()
    WHERE tenant_id = current_setting('app.tenant_id')::uuid
      AND id = ${allocation.lotId}`;
  await tx`
    INSERT INTO token_recognition_allocations (
      tenant_id, lot_id, hold_id, reference_id, quantity,
      consumed_before, consumed_after, recognized_before_minor,
      recognized_after_minor, recognition_minor, ledger_txn_id
    ) VALUES (
      current_setting('app.tenant_id')::uuid, ${allocation.lotId},
      ${allocation.holdId}, ${referenceId}, ${allocation.quantity.toString()}::bigint,
      ${consumedBefore.toString()}::bigint, ${consumedAfter.toString()}::bigint,
      ${recognizedBefore.toString()}::bigint, ${recognizedAfter.toString()}::bigint,
      ${recognitionMinor.toString()}::bigint, ${ledgerTxnId}
    )`;
}

function recognitionForLot(
  lot: LotRow,
  position: {
    readonly totalUnits: bigint;
    readonly consumedBefore: bigint;
    readonly quantity: bigint;
  },
): bigint {
  if (lot.pricing_model === "fixed_bundle") {
    if (lot.total_price_minor_locked === null) {
      throw new Error("Fixed-total token lot has no locked total price.");
    }
    return allocateCommercialOfferRecognition({
      totalPriceMinor: BigInt(lot.total_price_minor_locked),
      totalUnits: position.totalUnits,
      consumedBefore: position.consumedBefore,
      quantity: position.quantity,
    });
  }
  if (lot.unit_price_minor_locked === null) {
    throw new Error("Unit-priced token lot has no locked unit price.");
  }
  return BigInt(lot.unit_price_minor_locked) * position.quantity;
}
