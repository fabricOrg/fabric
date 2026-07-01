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

/**
 * SEND PIPELINE (L5) — normalize → segment → rate → RESERVE → send → COMMIT-on-billable | REFUND,
 * DLR reconcile (out-of-order tolerant), and the TTL sweeper. Orchestrates @app/wallet primitives +
 * the SmsSenderPlugin over @app/db `withTenant`. The commit/refund DECISION is @app/domain
 * (decideResolution); money movement is @app/wallet; this is the I/O orchestration.
 *
 * Two-phase on purpose (B2): tx1 persists the message as `sending` + reserves BEFORE the network
 * call (so a crash/retry can't double-send/double-charge — reserve is idempotent on reserve:{id});
 * then send() runs OUTSIDE any open tx; then tx2 applies the outcome. commit/refund are idempotent
 * (commit:{id}/refund:{id}) and mutually exclusive (B6 index) — so reconcile/sweeper are safe to retry.
 */

type Row = Record<string, unknown>;

export interface EngineDeps {
  db: AppDb;
  provider: SmsSenderPlugin;
  creds?: Creds;
  rates?: RateTable;
}

export interface SendInput {
  tenantId: string;
  to: string;
  senderId: string;
  body: string;
  currency: string;
  subjectId?: string;
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
    SELECT status FROM messages WHERE id = ${messageId} FOR UPDATE`) as Row[];
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
  return newStatus;
}

/** POST /v1/sms/send core: segment → rate → reserve+persist(sending) → send → resolve. */
export async function sendSms(
  deps: EngineDeps,
  input: SendInput,
): Promise<SendResult> {
  const seg = encodeAndSegment(input.body);
  const cost = rateSegments(seg.segments, input.currency, deps.rates);

  // tx1 — persist as `sending` + reserve, atomically, BEFORE the network call (B2).
  const messageId = await deps.db.withTenant(input.tenantId, async (tx) => {
    const rows = (await tx`
      INSERT INTO messages (tenant_id, subject_id, sender_id, status, status_rank, encoding, segments, cost_minor, currency, provider_slug)
      VALUES (current_setting('app.tenant_id')::uuid, ${input.subjectId ?? null}, ${input.senderId}, 'sending', ${STATUS_RANK.sending}, ${seg.encoding}, ${seg.segments}, ${cost.toString()}::bigint, ${input.currency}, ${deps.provider.slug})
      RETURNING id`) as Row[];
    const id = String(rows[0]?.id);
    await reserve(tx, {
      currency: input.currency,
      amountMinor: cost,
      idempotencyKey: `reserve:${id}`,
      referenceId: id,
    });
    return id;
  });

  // send() OUTSIDE any open transaction.
  const result = await deps.provider.send(
    {
      messageId,
      to: input.to,
      senderId: input.senderId,
      body: input.body,
      encoding: seg.encoding,
      segments: seg.segments,
    },
    deps.creds ?? {},
  );

  // tx2 — apply the provider's outcome (commit on `accepted`, refund on submit-fault, else pending).
  const status = await deps.db.withTenant(input.tenantId, (tx) =>
    resolveMessage(deps, tx, messageId, result.status, {
      providerRef: result.providerRef,
    }),
  );
  return { messageId, status };
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
      await resolveMessage(deps, tx, String(row.id), "expired", {});
    }
    return stuck.length;
  });
}
