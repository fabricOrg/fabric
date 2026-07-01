/**
 * Wallet domain errors. Server-side; the API boundary maps these to the F8.3 error envelope
 * (@app/contracts) — e.g. InsufficientFundsError → `insufficient_funds_error`. Kept here (not in
 * browser-safe @app/contracts) because they carry server-only detail and are thrown by DB ops.
 */

export class WalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Balance-gate rejection: a reserve/spend would drive the customer balance below zero (S5). */
export class InsufficientFundsError extends WalletError {
  constructor(
    readonly currency: string,
    readonly availableMinor: bigint,
    readonly requiredMinor: bigint,
  ) {
    super(
      `insufficient funds in ${currency}: have ${availableMinor}, need ${requiredMinor}`,
    );
  }
}

/**
 * B8/F8.2: the idempotency key was already used with a DIFFERENT body (fingerprint). A replay must
 * be byte-identical; a same-key/different-amount request is a client bug, not a replay — we refuse
 * (409-mappable) rather than silently reuse the prior result.
 */
export class IdempotencyConflictError extends WalletError {
  constructor(readonly idempotencyKey: string) {
    super(
      `idempotency key ${idempotencyKey} was already used with a different request body`,
    );
  }
}

/** commit/refund referenced a message that has no open reservation to resolve. */
export class NoReservationError extends WalletError {
  constructor(readonly referenceId: string) {
    super(`no open sms_reserve reservation for reference ${referenceId}`);
  }
}

/**
 * B6: the message already has a terminal resolution (committed XOR refunded). Raised when a second,
 * different resolution is attempted — the DB partial-unique index is the source of truth; this maps
 * the constraint violation to a typed, caller-handleable error (L5 treats it as already-resolved).
 */
export class AlreadyResolvedError extends WalletError {
  constructor(readonly referenceId: string) {
    super(
      `reference ${referenceId} already has a terminal resolution (commit XOR refund)`,
    );
  }
}
