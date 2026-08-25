import type { TenantTx } from "@app/db";
import { decideResolution } from "@app/domain";
import {
  isTerminalMessageStatus,
  type MessageStatus,
  STATUS_RANK,
  smsResolutionAdapterFor,
} from "@app/integrations";
import { commit, refund } from "@app/wallet";
import type {
  EngineDeps,
  PreparedSend,
  SendInput,
  SendResult,
} from "./engine-types.js";
import { prepareSend } from "./prepare-send.js";

/** Two-phase SMS pipeline: persist + claim backing, dispatch outside the transaction, then reconcile. */

type Row = Record<string, unknown>;

/**
 * The shared transition core (send-outcome, DLR, sweeper all funnel here). Locks the message row
 * FOR UPDATE (the PRIMARY B6 guard), applies the out-of-order/terminal-freeze monotonicity (F5.4),
 * asks @app/domain for the money decision, moves money via the idempotent wallet primitives, and
 * records the new status. Returns the message's status after the transition.
 */
async function resolveMessage(
  deps: EngineDeps,
  tx: TenantTx,
  messageId: string,
  newStatus: MessageStatus,
  opts: {
    providerRef?: string | undefined;
    faultCause?: string | undefined;
    errorCode?: string | undefined;
    /**
     * Set ONLY by the dispatch path, naming the adapter that just handed the message to a vendor.
     * `provider_slug` is stamped at PREPARE time, but on the queued path a worker may dispatch much
     * later — long enough for control-plane selection to have changed — so the stamped value can
     * name a provider that did not send this message. The dispatcher is the one caller that knows
     * for certain, so it re-stamps the row and its own rules govern this transition.
     */
    dispatchedBySlug?: string | undefined;
  } = {},
): Promise<MessageStatus> {
  const rows = (await tx`
    SELECT status, application_id, environment_id, backing, provider_slug
    FROM messages WHERE id = ${messageId} FOR UPDATE`) as Row[];
  const prior = String(rows[0]?.status) as MessageStatus;
  const backing = String(rows[0]?.backing ?? "wallet");
  const tokenBacked = backing === "tokens";
  const sandboxBacked = backing === "sandbox_allowance";
  // Terminal-freeze + monotonicity: never regress a recorded status or overwrite a terminal one.
  if (isTerminalMessageStatus(prior)) return prior;
  if (STATUS_RANK[newStatus] < STATUS_RANK[prior]) return prior;

  // Bill against the adapter that ACTUALLY dispatched this message (recorded in provider_slug at
  // prepare time), not whichever provider the control plane resolves to right now. Once providers
  // are control-plane config (ADR-0011), staff can swap a vendor between a send and its DLR/sweep —
  // and `billableStatuses` differs per adapter (`arkesel-sms` bills at `accepted`, `virtual-phone`
  // at `undelivered`), which is exactly the threshold `reachedBillable` below compares against.
  // Resolving with the current provider would charge, or refund, against a contract this message
  // never used.
  //
  // Unknown slug (an adapter removed from this build) falls back to the caller's provider: a wrong
  // guess is bad, but stranding the reservation forever is worse, and the sweeper must still finish.
  const recordedSlug = rows[0]?.provider_slug
    ? String(rows[0].provider_slug)
    : null;
  // On the DISPATCH path the caller just spoke to the vendor, so `deps.provider` IS the dispatching
  // adapter and is authoritative — it also re-stamps provider_slug below, correcting a row whose
  // prepare-time guess has since gone stale. On DLR and sweep we were not the sender, so the row's
  // recorded slug is the only honest answer.
  const dispatchedBy = opts.dispatchedBySlug
    ? deps.provider
    : ((recordedSlug ? smsResolutionAdapterFor(recordedSlug)?.() : null) ??
      deps.provider);

  const billable = dispatchedBy.billableStatuses;
  const reachedBillable =
    STATUS_RANK[prior] >= STATUS_RANK[billable[0] as MessageStatus];
  const decision = decideResolution({
    newStatus,
    reachedBillable,
    billableStatuses: billable,
    platformFaultExemptions: dispatchedBy.platformFaultExemptions,
    faultCause: opts.faultCause,
  });
  // The DECISION is channel- and backing-neutral (@app/domain owns it); only the EFFECTOR differs.
  // A token-backed send settles its holds and must never touch the ledger — it never reserved money,
  // so a commit/refund here would throw NoReservationError at best and mis-state revenue at worst.
  if (decision === "commit" && !sandboxBacked) {
    if (tokenBacked) {
      await deps.tokens?.resolve(tx, messageId, "committed");
    } else {
      await commit(tx, {
        referenceId: messageId,
        idempotencyKey: `commit:${messageId}`,
      });
    }
  } else if (decision === "refund" && !sandboxBacked) {
    if (tokenBacked) {
      await deps.tokens?.resolve(tx, messageId, "returned");
    } else {
      await refund(tx, {
        referenceId: messageId,
        idempotencyKey: `refund:${messageId}`,
      });
    }
  }
  await tx`
    UPDATE messages SET
      status = ${newStatus},
      status_rank = ${STATUS_RANK[newStatus]},
      provider_ref = COALESCE(${opts.providerRef ?? null}, provider_ref),
      -- Correct the prepare-time stamp to whoever actually dispatched, so later DLR lookups and
      -- sweeps settle against the real provider rather than a selection that has since changed.
      provider_slug = COALESCE(${opts.dispatchedBySlug ?? null}, provider_slug),
      error_code = COALESCE(${opts.errorCode ?? null}, error_code),
      updated_at = now()
    WHERE id = ${messageId}`;
  await tx`
    UPDATE message_delivery_attempts SET
      status = ${newStatus},
      cost_minor = (SELECT cost_minor FROM messages WHERE id = ${messageId}),
      error_code = COALESCE(${opts.errorCode ?? null}, error_code),
      provider_accepted_at = CASE
        WHEN ${newStatus} IN ('accepted', 'sent', 'delivered', 'undelivered')
          THEN COALESCE(provider_accepted_at, now())
        ELSE provider_accepted_at
      END,
      updated_at = now()
    WHERE message_id = ${messageId}`;
  await tx`
    UPDATE message_deliveries SET
      status = ${newStatus},
      total_cost_minor = (SELECT cost_minor FROM messages WHERE id = ${messageId}),
      resource_version = resource_version + 1,
      updated_at = now()
    WHERE id = (
      SELECT delivery_id FROM message_delivery_attempts WHERE message_id = ${messageId}
    )`;
  const applicationId = rows[0]?.application_id
    ? String(rows[0].application_id)
    : null;
  const environmentId = rows[0]?.environment_id
    ? String(rows[0].environment_id)
    : null;
  // Transactional outbox (finding 8): the domain event commits or rolls back WITH the status
  // change — never an event for a transition that didn't happen, never a lost transition.
  // Delivery to tenant-registered webhook endpoints is the poller/worker's job, not ours.
  await tx`
    INSERT INTO outbox_events (
      tenant_id, application_id, environment_id, event_type, payload
    )
    VALUES (
      current_setting('app.tenant_id')::uuid,
      ${applicationId},
      ${environmentId},
      'message.updated',
      ${JSON.stringify({
        message_id: messageId,
        status: newStatus,
        previous_status: prior,
        ...(opts.errorCode ? { error_code: opts.errorCode } : {}),
      })}::jsonb
    )`;
  return newStatus;
}

/**
 * Provider call + tx2 — runs inline (no queue) or in a worker (queued path). SAFE TO RETRY: a
 * crash after the provider accepted but before tx2 leaves the message `sending`; the retry's
 * resolveMessage is idempotent (FOR UPDATE + terminal-freeze + B6 commit/refund exclusivity),
 * and a re-send to the provider carries the same messageId for provider-side dedupe. A retry
 * that never succeeds is ultimately resolved by the TTL sweeper (refund).
 */
export async function dispatchSend(
  deps: EngineDeps,
  input: SendInput,
  prepared: PreparedSend,
): Promise<SendResult> {
  // send() OUTSIDE any open transaction.
  const result = await deps.provider.send(
    {
      messageId: prepared.messageId,
      to: input.to,
      senderId: input.senderId,
      body: input.body,
      encoding: prepared.encoding,
      segments: prepared.segments,
    },
    deps.creds ?? {},
  );

  // tx2 — apply the provider's outcome (commit on `accepted`, refund on submit-fault, else pending).
  const status = await deps.db.withTenant(input.tenantId, (tx) =>
    resolveMessage(deps, tx, prepared.messageId, result.status, {
      providerRef: result.providerRef,
      // We just sent it — record WHO, so settlement and DLR lookup key on fact rather than on the
      // provider that happened to be selected when the message was prepared.
      dispatchedBySlug: deps.provider.slug,
    }),
  );
  return { messageId: prepared.messageId, status };
}

/** Resolve a prepared send that cannot proceed before provider dispatch (for example, required
 * tenant-side delivery persistence failed). This immediately refunds the reservation instead of
 * leaving recovery to the TTL sweeper. */
export async function failPreparedSend(
  deps: EngineDeps,
  input: SendInput,
  prepared: PreparedSend,
  errorCode: string,
): Promise<SendResult> {
  const status = await deps.db.withTenant(input.tenantId, (tx) =>
    resolveMessage(deps, tx, prepared.messageId, "failed", { errorCode }),
  );
  return { messageId: prepared.messageId, status };
}

/** POST /v1/sms/messages inline core: prepare (tx1) → dispatch (send + tx2), one call. */
export async function sendSms(
  deps: EngineDeps,
  input: SendInput,
): Promise<SendResult> {
  const prepared = await prepareSend(deps, input);
  return dispatchSend(deps, input, prepared);
}

/** DLR webhook core: parse → reconcile (out-of-order tolerant) → commit/refund per the billing basis. */
export async function ingestDlr(
  deps: EngineDeps,
  tenantId: string,
  payload: unknown,
): Promise<MessageStatus> {
  const dlr = deps.provider.parseDlr(payload);
  return deps.db.withTenant(tenantId, async (tx) => {
    const rows = (await tx`
      SELECT id FROM messages WHERE provider_slug = ${deps.provider.slug} AND provider_ref = ${dlr.providerRef}`) as Row[];
    if (!rows[0])
      throw new Error(
        `ingestDlr: no message for providerRef ${dlr.providerRef}`,
      );
    return resolveMessage(deps, tx, String(rows[0].id), dlr.status, {
      faultCause: dlr.faultCause,
      errorCode: dlr.errorCode,
    });
  });
}

/**
 * Reservation sweeper (F3.3): resolve messages stuck non-terminal past the TTL as `expired`. S4
 * (reached `accepted` → committed) stays billed (decideResolution → 'none'); S6 (never-billable
 * `sending`/`queued`) → refund. Returns the number swept. `olderThanIso` = now − TTL.
 */
export async function sweepExpired(
  deps: EngineDeps,
  tenantId: string,
  olderThanIso: string,
): Promise<number> {
  return deps.db.withTenant(tenantId, async (tx) => {
    const stuck = (await tx`
      SELECT id FROM messages
      WHERE status IN ('queued','sending','accepted','sent') AND updated_at < ${olderThanIso}::timestamptz
      FOR UPDATE`) as Row[];
    for (const row of stuck) {
      // No per-message deps factory: resolveMessage reads each row's own provider_slug and bills
      // against the adapter that dispatched it. The previous `delivery_mode`-keyed factory was a
      // proxy for provider identity that only held while exactly one live provider could exist —
      // which is precisely what ADR-0011 stops being true.
      await resolveMessage(deps, tx, String(row.id), "expired", {});
    }
    return stuck.length;
  });
}
