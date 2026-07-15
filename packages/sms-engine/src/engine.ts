import type { AppDb, TenantTx } from "@app/db";
import {
  decideResolution,
  encodeAndSegment,
  type RateTable,
  rateSegments,
} from "@app/domain";
import {
  type Creds,
  isTerminalMessageStatus,
  type MessageStatus,
  type SmsSenderPlugin,
  STATUS_RANK,
} from "@app/integrations";
import { commit, refund, reserve } from "@app/wallet";

/** Two-phase SMS pipeline: persist + reserve, dispatch outside the transaction, then reconcile. */

type Row = Record<string, unknown>;

export interface EngineDeps {
  db: AppDb;
  provider: SmsSenderPlugin;
  creds?: Creds;
  rates?: RateTable;
}

export interface SendInput {
  tenantId: string;
  /** Stable caller-assigned ID for durable batch-item replay. */
  messageId?: string;
  applicationId?: string | null;
  environmentId?: string | null;
  to: string;
  senderId: string;
  body: string;
  currency: string;
  subjectId?: string;
  bodyPiiId?: string;
  deliveryMode?: "virtual" | "live";
}

export interface SendResult {
  messageId: string;
  status: MessageStatus;
}

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
  } = {},
): Promise<MessageStatus> {
  const rows = (await tx`
    SELECT status, application_id, environment_id
    FROM messages WHERE id = ${messageId} FOR UPDATE`) as Row[];
  const prior = String(rows[0]?.status) as MessageStatus;
  // Terminal-freeze + monotonicity: never regress a recorded status or overwrite a terminal one.
  if (isTerminalMessageStatus(prior)) return prior;
  if (STATUS_RANK[newStatus] < STATUS_RANK[prior]) return prior;

  const billable = deps.provider.billableStatuses;
  const reachedBillable =
    STATUS_RANK[prior] >= STATUS_RANK[billable[0] as MessageStatus];
  const decision = decideResolution({
    newStatus,
    reachedBillable,
    billableStatuses: billable,
    platformFaultExemptions: deps.provider.platformFaultExemptions,
    faultCause: opts.faultCause,
  });
  if (decision === "commit") {
    await commit(tx, {
      referenceId: messageId,
      idempotencyKey: `commit:${messageId}`,
    });
  } else if (decision === "refund") {
    await refund(tx, {
      referenceId: messageId,
      idempotencyKey: `refund:${messageId}`,
    });
  }
  await tx`
    UPDATE messages SET
      status = ${newStatus},
      status_rank = ${STATUS_RANK[newStatus]},
      provider_ref = COALESCE(${opts.providerRef ?? null}, provider_ref),
      error_code = COALESCE(${opts.errorCode ?? null}, error_code),
      updated_at = now()
    WHERE id = ${messageId}`;
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

/** The persisted-and-reserved message tx1 produced — everything dispatch needs later. */
export interface PreparedSend {
  messageId: string;
  encoding: "gsm7" | "ucs2";
  segments: number;
}

/**
 * tx1 — segment → rate → persist as `sending` + reserve, atomically, BEFORE any network call (B2).
 * Kept separate from {@link dispatchSend} so the API can run THIS in-request (insufficient funds
 * still fails the request synchronously) and hand the provider call to a queue worker.
 */
export async function prepareSend(
  deps: EngineDeps,
  input: SendInput,
): Promise<PreparedSend> {
  const seg = encodeAndSegment(input.body);
  const cost = rateSegments(seg.segments, input.currency, deps.rates);

  const messageId = await deps.db.withTenant(input.tenantId, async (tx) => {
    const rows = (await tx`
      INSERT INTO messages (
        id, tenant_id, application_id, environment_id, subject_id, body_pii_id, sender_id,
        status, status_rank, encoding, segments, cost_minor, currency, delivery_mode, provider_slug
      )
      VALUES (
        COALESCE(${input.messageId ?? null}::uuid, gen_random_uuid()),
        current_setting('app.tenant_id')::uuid, ${input.applicationId ?? null},
        ${input.environmentId ?? null}, ${input.subjectId ?? null}, ${input.bodyPiiId ?? null},
        ${input.senderId}, 'sending', ${STATUS_RANK.sending}, ${seg.encoding}, ${seg.segments},
        ${cost.toString()}::bigint, ${input.currency}, ${input.deliveryMode ?? "live"},
        ${deps.provider.slug}
      ) ON CONFLICT (id) DO NOTHING
      RETURNING id`) as Row[];
    const createdId = rows[0]?.id;
    const existing =
      !createdId && input.messageId
        ? (
            (await tx`
            SELECT id FROM messages WHERE id = ${input.messageId} LIMIT 1`) as Row[]
          )[0]?.id
        : null;
    const resolvedId = createdId ?? existing;
    if (!resolvedId) throw new Error("Could not persist the prepared message.");
    const id = String(resolvedId);
    await reserve(tx, {
      currency: input.currency,
      amountMinor: cost,
      idempotencyKey: `reserve:${id}`,
      referenceId: id,
    });
    // The dispatch intent commits with the message + reservation. Redis is an accelerator, not the
    // source of truth: a crash or enqueue outage leaves a recoverable pending row.
    await tx`
      INSERT INTO message_dispatches (message_id, tenant_id)
      VALUES (${id}, current_setting('app.tenant_id')::uuid)
      ON CONFLICT (message_id) DO NOTHING`;
    return id;
  });
  return { messageId, encoding: seg.encoding, segments: seg.segments };
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

/** POST /v1/sms/send inline core: prepare (tx1) → dispatch (send + tx2), one call. */
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
  depsForMode?: (deliveryMode: "virtual" | "live") => EngineDeps,
): Promise<number> {
  return deps.db.withTenant(tenantId, async (tx) => {
    const stuck = (await tx`
      SELECT id, delivery_mode FROM messages
      WHERE status IN ('queued','sending','accepted','sent') AND updated_at < ${olderThanIso}::timestamptz
      FOR UPDATE`) as Row[];
    for (const row of stuck) {
      const mode = row.delivery_mode === "virtual" ? "virtual" : "live";
      await resolveMessage(
        depsForMode?.(mode) ?? deps,
        tx,
        String(row.id),
        "expired",
        {},
      );
    }
    return stuck.length;
  });
}
