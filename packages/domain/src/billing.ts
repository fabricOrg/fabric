import { isTerminalMessageStatus, type MessageStatus } from "@app/contracts";

/**
 * Honest-billing resolution decision (F5 / SMS-FEATURES §5.A) — PURE. Given a status transition and
 * the provider's billing basis, decide whether this transition should COMMIT the reservation (bill),
 * REFUND it (release), or do nothing. The engine performs the I/O (wallet.commit/refund) and the
 * ledger enforces commit-XOR-refund (B6) + idempotency; this function is only the decision.
 *
 * `reachedBillable` = did the message ALREADY reach a billable status (i.e. we already committed)?
 * The engine computes it from the PRIOR (pre-transition, always non-terminal) status via STATUS_RANK.
 * It's the S4-vs-S6 discriminator:
 *   - S4: accepted (committed) → later `expired` ⇒ reachedBillable=true ⇒ 'none' (stays billed; the
 *     provider took it, the DLR just never came — never refund a legitimately-billed message).
 *   - S6: `sending` (never accepted) → `expired` ⇒ reachedBillable=false + terminal ⇒ 'refund'.
 * (A platform fault AFTER commit would be an `adjustment` reversal, not a refund — out of the thin
 * thread; here reachedBillable=true short-circuits to 'none'.)
 */
export type Resolution = "commit" | "refund" | "none";

export interface ResolutionInput {
  /** the status we're transitioning TO (from send() or a DLR/sweeper) */
  newStatus: MessageStatus;
  /** did the message already reach a billable status (⇒ already committed)? */
  reachedBillable: boolean;
  /** provider's billable statuses (commit fires on billableStatuses[0], default 'accepted') */
  billableStatuses: readonly MessageStatus[];
  /** fault causes this provider is never billed for → auto-refund (never charge for our fault) */
  platformFaultExemptions: readonly string[];
  /** platform-fault cause on this transition, if any (from a DLR/faultCause) */
  faultCause?: string | undefined;
}

export function decideResolution(input: ResolutionInput): Resolution {
  const {
    newStatus,
    reachedBillable,
    billableStatuses,
    platformFaultExemptions,
    faultCause,
  } = input;
  // Already committed → this transition moves no money (post-commit reversal = adjustment, follow-up).
  if (reachedBillable) return "none";
  // Our fault → never charge; release the reservation.
  if (faultCause && platformFaultExemptions.includes(faultCause))
    return "refund";
  // Reached the billable point (and wasn't billed before) → recognize the charge.
  if (billableStatuses.includes(newStatus)) return "commit";
  // Terminal without ever billing (reject-at-submit, never-billable sweep) → release the reservation.
  if (isTerminalMessageStatus(newStatus)) return "refund";
  // Still in flight (e.g. 'sending') → wait for a DLR or the TTL sweeper.
  return "none";
}
