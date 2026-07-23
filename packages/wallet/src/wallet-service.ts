import type { TenantTx } from "@app/db";
import { InsufficientFundsError } from "./errors.js";
import {
  accountId,
  openIdempotentTxn,
  openTerminalTxn,
  postLegs,
  type Row,
  reservedFor,
} from "./internal.js";

/**
 * WALLET SERVICE (L3) — reserve / commit / refund / credit over the append-only double-entry ledger
 * (ledger-double-entry v1.0.0). PRIMITIVES: each takes an in-context `TenantTx` (from @app/db
 * `withTenant`, so RLS is scoped + `app.tenant_id` is set) and posts a BALANCED 2-leg movement. The
 * cached `balance_minor` projection is maintained WRITE-TIME by the ledger_apply_entry trigger (E3) —
 * the primitives no longer touch it — so it can't drift from the legs. L5 (send pipeline) orchestrates
 * them (reserve → send → commit-on-`accepted` | sweeper-refund-on-never-billable-TTL).
 *
 * Guarantees: exactly-once with a body-fingerprint compare — same key + same body → replay the
 * stored txn; same key + different body → IdempotencyConflictError (B8/F8.2). No overdraw — reserve
 * locks the customer row FOR UPDATE and rejects below zero (S5, negative only via adjustment).
 * Commit XOR refund via the uniq_ledger_txn_resolution_per_message partial index (B6).
 */

export interface ReserveParams {
  currency: string;
  amountMinor: bigint;
  /** deterministic, e.g. `reserve:{messageId}` */
  idempotencyKey: string;
  /** the message being reserved for */
  referenceId: string;
}

export interface MovementResult {
  txnId: string;
  amountMinor: bigint;
  /** true when the idempotency key already existed (same body) → no money moved this call. */
  replayed: boolean;
}

/**
 * TOP-UP: external funds in. DEBIT gateway_clearing / CREDIT customer (balance ↑ once). Idempotent
 * on `topup:{paymentId}` — only ONE credit lands even if callback+webhook both fire (B8).
 */
export async function credit(
  tx: TenantTx,
  p: {
    currency: string;
    amountMinor: bigint;
    idempotencyKey: string;
    referenceId?: string;
  },
): Promise<MovementResult> {
  const refId = p.referenceId ?? null;
  const { txnId, replayed } = await openIdempotentTxn(tx, {
    type: "topup",
    status: "committed",
    idempotencyKey: p.idempotencyKey,
    referenceId: refId,
    fingerprint: {
      op: "topup",
      currency: p.currency,
      amount: p.amountMinor.toString(),
      ref: refId ?? "",
    },
  });
  if (replayed) return { txnId, amountMinor: p.amountMinor, replayed: true };
  const gateway = await accountId(tx, p.currency, "gateway_clearing");
  const customer = await accountId(tx, p.currency, "customer");
  await postLegs(tx, txnId, refId, "topup", p.amountMinor, {
    debit: gateway,
    credit: customer,
  });
  // balance_minor is maintained by the ledger_apply_entry trigger (write-time enforcement, E3).
  return { txnId, amountMinor: p.amountMinor, replayed: false };
}

/**
 * RESERVE: DEBIT customer / CREDIT reserved_clearing (balance ↓ once, funds parked). Locks the
 * customer row FOR UPDATE and rejects overdraw (S5). Idempotent on `reserve:{messageId}`.
 */
export async function reserve(
  tx: TenantTx,
  p: ReserveParams,
): Promise<MovementResult> {
  const { txnId, replayed } = await openIdempotentTxn(tx, {
    type: "sms_charge",
    status: "pending",
    idempotencyKey: p.idempotencyKey,
    referenceId: p.referenceId,
    fingerprint: {
      op: "reserve",
      currency: p.currency,
      amount: p.amountMinor.toString(),
      ref: p.referenceId,
    },
  });
  if (replayed) return { txnId, amountMinor: p.amountMinor, replayed: true };
  const customer = await accountId(tx, p.currency, "customer");
  const reserved = await accountId(tx, p.currency, "reserved_clearing");
  // Serialize concurrent spends on this wallet + read the authoritative balance.
  const balRows = (await tx`
    SELECT balance_minor FROM ledger_accounts WHERE id = ${customer} FOR UPDATE`) as Row[];
  const balance = BigInt(String(balRows[0]?.balance_minor ?? "0"));
  if (balance < p.amountMinor) {
    throw new InsufficientFundsError(p.currency, balance, p.amountMinor);
  }
  // Channel-neutral reason (SDK-007): managed reserve backs SMS and Email. reservedFor() matches both
  // this and the legacy sms_reserve so in-flight/historical SMS reservations still commit/refund.
  await postLegs(tx, txnId, p.referenceId, "message_reserve", p.amountMinor, {
    debit: customer,
    credit: reserved,
  });
  // balance_minor maintained by the trigger; the FOR UPDATE + overdraw check above still gates spend.
  return { txnId, amountMinor: p.amountMinor, replayed: false };
}

/**
 * COMMIT: recognize reserved funds as revenue. DEBIT reserved_clearing / CREDIT revenue (customer
 * untouched — balance already moved at reserve). Terminal, B6-guarded. Idempotent `commit:{msgId}`.
 */
export async function commit(
  tx: TenantTx,
  p: { referenceId: string; idempotencyKey: string },
): Promise<MovementResult> {
  const { amountMinor, currency } = await reservedFor(tx, p.referenceId);
  const { txnId, replayed } = await openTerminalTxn(
    tx,
    "committed",
    p.idempotencyKey,
    p.referenceId,
    { op: "commit", ref: p.referenceId },
  );
  if (replayed) return { txnId, amountMinor, replayed: true };
  const reserved = await accountId(tx, currency, "reserved_clearing");
  const revenue = await accountId(tx, currency, "revenue");
  await postLegs(tx, txnId, p.referenceId, "message_commit", amountMinor, {
    debit: reserved,
    credit: revenue,
  });
  // balance_minor maintained by the ledger_apply_entry trigger (E3).
  return { txnId, amountMinor, replayed: false };
}

/**
 * REFUND: release the reservation back to the customer. DEBIT reserved_clearing / CREDIT customer
 * (balance ↑ back once). Terminal, B6-guarded. Idempotent `refund:{msgId}`. Used by the sweeper for
 * a reservation that never reached a billable status (never for a committed message).
 */
export async function refund(
  tx: TenantTx,
  p: { referenceId: string; idempotencyKey: string },
): Promise<MovementResult> {
  const { amountMinor, currency } = await reservedFor(tx, p.referenceId);
  const { txnId, replayed } = await openTerminalTxn(
    tx,
    "refunded",
    p.idempotencyKey,
    p.referenceId,
    { op: "refund", ref: p.referenceId },
  );
  if (replayed) return { txnId, amountMinor, replayed: true };
  const reserved = await accountId(tx, currency, "reserved_clearing");
  const customer = await accountId(tx, currency, "customer");
  await postLegs(tx, txnId, p.referenceId, "message_refund", amountMinor, {
    debit: reserved,
    credit: customer,
  });
  // balance_minor maintained by the ledger_apply_entry trigger (E3).
  return { txnId, amountMinor, replayed: false };
}
