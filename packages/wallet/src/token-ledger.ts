import type { TenantTx } from "@app/db";
import { accountId, openIdempotentTxn, postLegs } from "./internal.js";
import type { MovementResult } from "./wallet-service.js";

/**
 * TOKEN LEDGER (ADR-0010 Phase 2) — the MONEY half of a token purchase. The entitlement COUNT lives
 * in `token_lots` / `token_counters`; financial truth stays here, in the one double-entry ledger.
 *
 * Why deferred revenue and not `revenue`: cash taken for tokens is money we have but sends we still
 * OWE. Recognizing it at purchase would overstate revenue and hide the obligation. So a purchase
 * credits a LIABILITY (`token_deferred_revenue`) and slice 2c debits that liability into `revenue`
 * as each token is consumed, at the lot's locked price. Unused tokens are NON-refundable (ADR
 * follow-up), so there is deliberately no path from this liability back to a customer balance —
 * forfeiture is recognized as `token_breakage`, never repaid as cash.
 */

/**
 * PURCHASE: external funds in against the token liability. DEBIT gateway_clearing / CREDIT
 * token_deferred_revenue. The customer wallet is UNTOUCHED — token buyers may not have one at all.
 *
 * Idempotent on the purchase reference (mirrors `credit`'s `topup:{paymentId}`): a callback and a
 * webhook both firing post the movement exactly once, and a replay returns the stored txn having
 * moved no money. `purchaseId` (a uuid) is the ledger reference — the `token-{uuid}` provider
 * reference is text and lives in the idempotency key, since `reference_id` is a uuid column.
 */
export async function creditTokenPurchase(
  tx: TenantTx,
  p: {
    currency: string;
    amountMinor: bigint;
    /** deterministic, e.g. the `token-{uuid}` purchase reference */
    idempotencyKey: string;
    /** `token_purchases.id` — the uuid this movement is about */
    purchaseId: string;
  },
): Promise<MovementResult> {
  const { txnId, replayed } = await openIdempotentTxn(tx, {
    type: "token_purchase",
    // Terminal on arrival: the cash has cleared. What is NOT yet settled is the obligation, and that
    // is carried by the liability account's balance, not by a pending txn status.
    status: "committed",
    idempotencyKey: p.idempotencyKey,
    referenceId: p.purchaseId,
    referenceType: "token_purchase",
    fingerprint: {
      op: "token_purchase",
      currency: p.currency,
      amount: p.amountMinor.toString(),
      ref: p.purchaseId,
    },
  });
  if (replayed) return { txnId, amountMinor: p.amountMinor, replayed: true };
  const gateway = await accountId(tx, p.currency, "gateway_clearing");
  const deferred = await accountId(tx, p.currency, "token_deferred_revenue");
  await postLegs(
    tx,
    txnId,
    p.purchaseId,
    "token_purchase",
    p.amountMinor,
    { debit: gateway, credit: deferred },
    "token_purchase",
  );
  // balance_minor is maintained by the ledger_apply_entry trigger (E3), as for every other movement.
  return { txnId, amountMinor: p.amountMinor, replayed: false };
}

/**
 * CONSUMPTION: recognize revenue as tokens are actually used. DEBIT token_deferred_revenue / CREDIT
 * revenue — the liability we took on at purchase is discharged by delivering the send, which is the
 * moment the money is genuinely earned. The customer wallet is untouched: a token-backed send never
 * moved money, so there is nothing to debit.
 *
 * `amountMinor` is the LOT'S LOCKED price × the tokens consumed, never the current price book — that
 * price-lock is what a token purchase buys (ADR-0010 #3).
 *
 * Idempotent on `token_consume:{messageId}:{lotId}`, keyed per lot because one send can span lots at
 * different locked prices. A duplicate delivery callback recognizes nothing further.
 */
export async function recognizeTokenConsumption(
  tx: TenantTx,
  p: {
    currency: string;
    amountMinor: bigint;
    messageId: string;
    lotId: string;
  },
): Promise<MovementResult> {
  const idempotencyKey = `token_consume:${p.messageId}:${p.lotId}`;
  const { txnId, replayed } = await openIdempotentTxn(tx, {
    type: "token_consume",
    status: "committed",
    idempotencyKey,
    referenceId: p.messageId,
    referenceType: "message",
    fingerprint: {
      op: "token_consume",
      currency: p.currency,
      amount: p.amountMinor.toString(),
      ref: `${p.messageId}:${p.lotId}`,
    },
  });
  if (replayed) return { txnId, amountMinor: p.amountMinor, replayed: true };
  const deferred = await accountId(tx, p.currency, "token_deferred_revenue");
  const revenue = await accountId(tx, p.currency, "revenue");
  await postLegs(tx, txnId, p.messageId, "token_consume", p.amountMinor, {
    debit: deferred,
    credit: revenue,
  });
  return { txnId, amountMinor: p.amountMinor, replayed: false };
}

/**
 * EXPIRY: recognize the unearned consideration attached to credits that have contractually expired.
 * This is distinct from delivered-message revenue in reporting, but it discharges the same deferred
 * liability. Idempotency is per lot because a lot can cross the expiry boundary only once.
 */
export async function recognizeTokenBreakage(
  tx: TenantTx,
  p: {
    currency: string;
    amountMinor: bigint;
    lotId: string;
  },
): Promise<MovementResult> {
  const idempotencyKey = `token_breakage:${p.lotId}`;
  const { txnId, replayed } = await openIdempotentTxn(tx, {
    type: "token_breakage",
    status: "committed",
    idempotencyKey,
    referenceId: p.lotId,
    referenceType: "token_lot",
    fingerprint: {
      op: "token_breakage",
      currency: p.currency,
      amount: p.amountMinor.toString(),
      ref: p.lotId,
    },
  });
  if (replayed) return { txnId, amountMinor: p.amountMinor, replayed: true };
  const deferred = await accountId(tx, p.currency, "token_deferred_revenue");
  const revenue = await accountId(tx, p.currency, "revenue");
  // Arg order is (referenceId, REASON, amount, legs, REFERENCE_TYPE): the reason is the enum column,
  // the reference type names what the id points at.
  await postLegs(
    tx,
    txnId,
    p.lotId,
    "token_breakage",
    p.amountMinor,
    { debit: deferred, credit: revenue },
    "token_lot",
  );
  return { txnId, amountMinor: p.amountMinor, replayed: false };
}
