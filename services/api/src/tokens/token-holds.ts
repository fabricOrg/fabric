import type { TenantTx } from "@app/db";

/**
 * TOKEN HOLDS (ADR-0010 Phase 2, slice 2b) — the count-space mirror of the wallet's
 * reserve / commit / refund, honouring the same guarantees the review demanded:
 *
 *   HOLD    lock the counter FOR UPDATE, reject below the requested quantity, draw lots FIFO
 *   COMMIT  the tokens are spent — the counter already moved at hold time, so it does NOT move again
 *   RETURN  put the quantity back on the counter (failure / expiry sweep)
 *
 * FAIL CLOSED. Unlike price RESOLUTION (Phase 1, fails open to last-known-good), an entitlement check
 * must never fail open: no tokens → no hold → the caller falls through to the wallet, else rejects.
 *
 * COMMIT-XOR-RETURN is enforced by the conditional transition `WHERE status = 'pending'` rather than
 * a partial unique index: a send holds one row PER LOT, so "one terminal row per reference" would be
 * wrong here. Because only a pending row transitions, a concurrent commit and sweep-return cannot both
 * move the counter, and a repeat call updates zero rows — idempotent by construction.
 */

interface Row {
  [key: string]: unknown;
}

export interface TokenHoldAllocation {
  readonly lotId: string;
  readonly quantity: bigint;
  /** The lot's locked unit price — what slice 2c recognizes as revenue when this hold commits. */
  readonly unitPriceMinorLocked: bigint;
  /** The lot's currency, so recognition posts against the right per-currency ledger accounts. */
  readonly currency: string;
}

export interface TokenHoldResult {
  /** false = not enough tokens; the caller must fall through to the wallet (never a partial hold). */
  readonly held: boolean;
  /** true when this send already held tokens — a retried accept, no counter movement. */
  readonly replayed: boolean;
  readonly allocations: readonly TokenHoldAllocation[];
}

const NONE: TokenHoldResult = { held: false, replayed: false, allocations: [] };

/**
 * Claim `quantity` tokens for `referenceId`. ALL-OR-NOTHING: a send is either fully token-backed or
 * not token-backed at all, so the caller never has to split a charge across tokens and money.
 *
 * `quantity` is the SEGMENT count for SMS (ADR-0010 §5 prices SMS per segment) and 1 for email.
 * Runs inside the caller's tenant transaction so the hold and the message row commit together.
 */
export async function holdTokens(
  tx: TenantTx,
  p: {
    channel: string;
    currency: string;
    quantity: bigint;
    referenceId: string;
  },
): Promise<TokenHoldResult> {
  if (p.quantity <= 0n) return NONE;

  // Replay guard first — a retried accept must not claim a second set of tokens. Mirrors
  // prepareSend's replay check preceding the wallet reserve.
  const existing = (await tx`
    SELECT h.lot_id, h.quantity, h.currency, l.unit_price_minor_locked
    FROM token_holds h
    JOIN token_lots l ON l.id = h.lot_id
    WHERE h.tenant_id = current_setting('app.tenant_id')::uuid
      AND h.reference_id = ${p.referenceId} AND h.status <> 'returned'`) as Row[];
  if (existing.length > 0) {
    return {
      held: true,
      replayed: true,
      allocations: existing.map(toAllocation),
    };
  }

  // Serialize concurrent sends on this entitlement and read the authoritative count. The FOR UPDATE
  // is what stops two sends spending the same last token; the DB CHECK (available >= 0) is the
  // backstop if this guard is ever bypassed.
  const counters = (await tx`
    SELECT available FROM token_counters
    WHERE tenant_id = current_setting('app.tenant_id')::uuid
      AND channel = ${p.channel} AND currency = ${p.currency}
    FOR UPDATE`) as Row[];
  const available = BigInt(String(counters[0]?.available ?? "0"));
  if (available < p.quantity) return NONE;

  // Draw lots expiry-soonest then oldest (FIFO). `remaining` subtracts live claims, so a lot cannot
  // be over-drawn even though the counter is the aggregate.
  const lots = (await tx`
    SELECT l.id, l.unit_price_minor_locked,
           l.quantity_total - COALESCE(SUM(h.quantity)
             FILTER (WHERE h.status IN ('pending', 'committed')), 0) AS remaining
    FROM token_lots l
    LEFT JOIN token_holds h ON h.lot_id = l.id
    WHERE l.tenant_id = current_setting('app.tenant_id')::uuid
      AND l.channel = ${p.channel} AND l.currency = ${p.currency}
    GROUP BY l.id, l.unit_price_minor_locked, l.expires_at, l.created_at
    HAVING l.quantity_total - COALESCE(SUM(h.quantity)
             FILTER (WHERE h.status IN ('pending', 'committed')), 0) > 0
    ORDER BY l.expires_at ASC NULLS LAST, l.created_at ASC`) as Row[];

  const allocations: TokenHoldAllocation[] = [];
  let outstanding = p.quantity;
  for (const lot of lots) {
    if (outstanding === 0n) break;
    const remaining = BigInt(String(lot.remaining));
    const take = remaining < outstanding ? remaining : outstanding;
    allocations.push({
      lotId: String(lot.id),
      quantity: take,
      unitPriceMinorLocked: BigInt(String(lot.unit_price_minor_locked)),
      currency: p.currency,
    });
    outstanding -= take;
  }
  // The counter said there was enough but the lots disagree — the projection has drifted from its
  // backing rows. Refuse rather than hold tokens no lot can account for; the CI invariant will catch
  // the drift itself.
  if (outstanding > 0n) return NONE;

  for (const allocation of allocations) {
    await tx`
      INSERT INTO token_holds (
        tenant_id, lot_id, channel, currency, quantity, reference_id, idempotency_key
      ) VALUES (
        current_setting('app.tenant_id')::uuid, ${allocation.lotId}, ${p.channel}, ${p.currency},
        ${allocation.quantity.toString()}::bigint, ${p.referenceId},
        ${`hold:${p.referenceId}:${allocation.lotId}`}
      )
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING`;
  }

  await tx`
    UPDATE token_counters
    SET available = available - ${p.quantity.toString()}::bigint, updated_at = now()
    WHERE tenant_id = current_setting('app.tenant_id')::uuid
      AND channel = ${p.channel} AND currency = ${p.currency}`;

  return { held: true, replayed: false, allocations };
}

/**
 * Resolve every pending hold for a send. `committed` spends them (the counter already moved at hold
 * time, so it stays put); `returned` puts the quantity back. Idempotent: a repeat call, or a race
 * between the delivery callback and the sweeper, transitions zero rows and moves nothing.
 *
 * Returns the allocations actually transitioned — empty on a repeat — so slice 2c can post the
 * revenue-recognition legs at each lot's locked price for exactly the tokens consumed THIS call.
 */
export async function resolveTokenHolds(
  tx: TenantTx,
  referenceId: string,
  outcome: "committed" | "returned",
): Promise<readonly TokenHoldAllocation[]> {
  const rows = (await tx`
    UPDATE token_holds h
    SET status = ${outcome}, updated_at = now()
    FROM token_lots l
    WHERE l.id = h.lot_id
      AND h.tenant_id = current_setting('app.tenant_id')::uuid
      AND h.reference_id = ${referenceId}
      AND h.status = 'pending'
    RETURNING h.lot_id, h.quantity, h.channel, h.currency, l.unit_price_minor_locked`) as Row[];
  if (rows.length === 0) return [];

  if (outcome === "returned") {
    // Give the tokens back on the counter the hold took them from. Grouped so a multi-lot hold
    // restores one total per (channel, currency).
    const first = rows[0] as Row;
    const total = rows.reduce(
      (sum, row) => sum + BigInt(String(row.quantity)),
      0n,
    );
    await tx`
      UPDATE token_counters
      SET available = available + ${total.toString()}::bigint, updated_at = now()
      WHERE tenant_id = current_setting('app.tenant_id')::uuid
        AND channel = ${String(first.channel)} AND currency = ${String(first.currency)}`;
  }
  return rows.map(toAllocation);
}

function toAllocation(row: Row): TokenHoldAllocation {
  return {
    lotId: String(row.lot_id),
    quantity: BigInt(String(row.quantity)),
    unitPriceMinorLocked: BigInt(String(row.unit_price_minor_locked)),
    currency: String(row.currency),
  };
}
