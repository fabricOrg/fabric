import type { TenantTx } from "@app/db";
import {
  AlreadyResolvedError,
  IdempotencyConflictError,
  NoReservationError,
} from "./errors.js";

/**
 * Internal ledger-posting helpers shared by the wallet primitives (wallet-service.ts). Each runs on
 * an in-context TenantTx; tenant_id on every write = current_setting('app.tenant_id')::uuid so the
 * row is bound to the ambient tenant and always satisfies the RLS WITH CHECK.
 */

export type Row = Record<string, unknown>;

export type AccountKind =
  | "customer"
  | "reserved_clearing"
  | "revenue"
  | "gateway_clearing"
  | "writeoff"
  // ADR-0010 Phase 2: the liability contra holding cash taken for tokens not yet sent.
  | "token_deferred_revenue";

/** A stable per-request body fingerprint (all string values) stored in ledger_transactions.metadata. */
export type Fingerprint = Record<string, string>;

export interface TxnHandle {
  txnId: string;
  /** true when the idempotency key already existed with an identical fingerprint (replay). */
  replayed: boolean;
}

/** A DB uniqueness violation carrying the constraint name (postgres.js error shape). */
export function constraintName(err: unknown): string | undefined {
  if (err && typeof err === "object" && "constraint_name" in err) {
    return String((err as { constraint_name?: unknown }).constraint_name);
  }
  return undefined;
}

/** Canonical string of an object (sorted keys, string values) for fingerprint equality. */
function canon(o: Record<string, unknown>): string {
  const norm: Record<string, string> = {};
  for (const k of Object.keys(o).sort()) norm[k] = String(o[k]);
  return JSON.stringify(norm);
}

/** Lazily provision (fifi-ratified) the (tenant, currency, kind) account and return its id. */
export async function accountId(
  tx: TenantTx,
  currency: string,
  kind: AccountKind,
): Promise<string> {
  const rows = (await tx`
    INSERT INTO ledger_accounts (tenant_id, kind, currency)
    VALUES (current_setting('app.tenant_id')::uuid, ${kind}, ${currency})
    ON CONFLICT (tenant_id, currency, kind) DO UPDATE SET updated_at = now()
    RETURNING id`) as Row[];
  return String(rows[0]?.id);
}

/**
 * Post the two balanced legs of a movement (magnitudes; direction carries the sign).
 *
 * `referenceType` defaults to the historical `'message'`-when-referenced behaviour; a token purchase
 * (ADR-0010) passes `'token_purchase'` because its reference is a purchase, not a message.
 */
export async function postLegs(
  tx: TenantTx,
  txnId: string,
  referenceId: string | null,
  reason: string,
  amountMinor: bigint,
  legs: { debit: string; credit: string },
  referenceType?: string,
): Promise<void> {
  // amounts as string + ::bigint cast — postgres.js tagged-template params don't type bigint directly.
  const amt = amountMinor.toString();
  const refType = referenceType ?? (referenceId ? "message" : null);
  await tx`
    INSERT INTO ledger_entries (tenant_id, txn_id, account_id, direction, amount_minor, reason, reference_type, reference_id)
    VALUES
      (current_setting('app.tenant_id')::uuid, ${txnId}, ${legs.debit},  'debit',  ${amt}::bigint, ${reason}, ${refType}, ${referenceId}),
      (current_setting('app.tenant_id')::uuid, ${txnId}, ${legs.credit}, 'credit', ${amt}::bigint, ${reason}, ${refType}, ${referenceId})`;
}

/**
 * Insert a transaction envelope IDEMPOTENTLY (B8/F8.2). Stores `fingerprint` in metadata. On a
 * same-key conflict: identical fingerprint → { replayed:true } (return the stored txn, move no
 * money); DIFFERENT fingerprint → IdempotencyConflictError (a replay must be byte-identical — a
 * same-key/different-body request is a client bug, never a silent reuse).
 */
export async function openIdempotentTxn(
  tx: TenantTx,
  args: {
    type: "topup" | "sms_charge" | "token_purchase";
    status: "pending" | "committed" | "refunded";
    idempotencyKey: string;
    referenceId: string | null;
    fingerprint: Fingerprint;
    /** Defaults to the historical `'message'`-when-referenced behaviour (see postLegs). */
    referenceType?: string;
  },
): Promise<TxnHandle> {
  const fp = JSON.stringify(args.fingerprint);
  const refType = args.referenceType ?? (args.referenceId ? "message" : null);
  const rows = (await tx`
    INSERT INTO ledger_transactions (tenant_id, type, status, idempotency_key, reference_type, reference_id, metadata)
    VALUES (current_setting('app.tenant_id')::uuid, ${args.type}, ${args.status}, ${args.idempotencyKey}, ${refType}, ${args.referenceId}, ${fp}::jsonb)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING id`) as Row[];
  if (rows[0]) return { txnId: String(rows[0].id), replayed: false };
  // same idempotency key already exists → compare the stored fingerprint.
  const existing = (await tx`
    SELECT id, metadata FROM ledger_transactions WHERE idempotency_key = ${args.idempotencyKey}`) as Row[];
  // postgres.js may hand back jsonb as a parsed object OR a raw string depending on driver config;
  // normalize both to an object before the canonical compare.
  const raw = existing[0]?.metadata;
  const storedMeta = (
    typeof raw === "string" ? JSON.parse(raw) : (raw ?? {})
  ) as Record<string, unknown>;
  if (canon(storedMeta) !== canon(args.fingerprint)) {
    throw new IdempotencyConflictError(args.idempotencyKey);
  }
  return { txnId: String(existing[0]?.id), replayed: true };
}

/**
 * Open a TERMINAL (committed|refunded) sms_charge txn idempotently. Beyond the idempotency-key
 * dedup, the B6 partial-unique index (tenant_id, reference_id WHERE status IN committed|refunded)
 * throws if a DIFFERENT terminal resolution already exists for the message → AlreadyResolvedError.
 */
export async function openTerminalTxn(
  tx: TenantTx,
  status: "committed" | "refunded",
  idempotencyKey: string,
  referenceId: string,
  fingerprint: Fingerprint,
): Promise<TxnHandle> {
  try {
    return await openIdempotentTxn(tx, {
      type: "sms_charge",
      status,
      idempotencyKey,
      referenceId,
      fingerprint,
    });
  } catch (err) {
    if (constraintName(err) === "uniq_ledger_txn_resolution_per_message") {
      throw new AlreadyResolvedError(referenceId);
    }
    throw err;
  }
}

/**
 * The reserved amount + currency for a message (from its reserve reserved_clearing credit). Matches
 * BOTH the channel-neutral message_reserve (SDK-007 onward) and the legacy sms_reserve so a reservation
 * placed before the rename still commits/refunds. A reference has at most one reserve leg, so the IN is
 * unambiguous.
 */
export async function reservedFor(
  tx: TenantTx,
  referenceId: string,
): Promise<{ amountMinor: bigint; currency: string }> {
  const rows = (await tx`
    SELECT e.amount_minor, a.currency
    FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
    WHERE e.reference_id = ${referenceId}
      AND e.reason IN ('message_reserve', 'sms_reserve')
      AND a.kind = 'reserved_clearing' AND e.direction = 'credit'`) as Row[];
  if (!rows[0]) throw new NoReservationError(referenceId);
  return {
    amountMinor: BigInt(String(rows[0].amount_minor)),
    currency: String(rows[0].currency),
  };
}
