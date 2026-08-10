import type { DeliveryMode, MessageStatus } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { PreparedSend, SendInput } from "@app/sms-engine";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";

type Row = Record<string, unknown>;

export type StoredDispatch =
  | { kind: "skip"; status: MessageStatus }
  | {
      kind: "ready";
      input: SendInput;
      prepared: PreparedSend;
      deliveryMode: DeliveryMode;
    }
  | {
      kind: "unreadable";
      input: SendInput;
      prepared: PreparedSend;
      deliveryMode: DeliveryMode;
    };

/**
 * How long a claimed dispatch stays claimed before another worker may take it.
 *
 * The claim stops a double-send; the expiry stops the claim from turning a crash into a permanent
 * orphan whose wallet reserve is never settled. Far longer than a carrier call plus its retries, so a
 * slow send is never stolen from a worker still working on it.
 *
 * Bound as a PARAMETER cast to interval, never interpolated into a quoted literal — postgres.js
 * parameterises the placeholder, so surrounding quotes would be a syntax error.
 */
const LEASE_TIMEOUT = "5 minutes";

/**
 * CLAIM a dispatch, then read what it needs to send.
 *
 * This replaced a plain SELECT, and the difference is the whole point. Reading first and locking later
 * meant the first database lock landed AFTER the carrier call: two workers on one Redis queue (two API
 * instances sharing REDIS_QUEUE_URL, or a retry racing the original) both saw a non-terminal row and
 * both sent. Two real SMS, two charges, one message id. This is the same defect fixed for WhatsApp in
 * d341789, recorded there as still open here.
 *
 * The transition is atomic — one statement claims and returns, so there is no window between deciding
 * to send and being the only one allowed to. A dispatch already claimed with a FRESH lease is reported
 * as skipped rather than sent again.
 */
export async function claimStoredDispatch(input: {
  db: AppDb;
  vault: PiiVaultService;
  tenantId: string;
  messageId: string;
}): Promise<StoredDispatch> {
  const rows = (await input.db.withTenant(
    input.tenantId,
    (tx) => tx`
      WITH claim AS (
        SELECT d.message_id
        FROM message_dispatches d
        JOIN messages m ON m.id = d.message_id
        WHERE d.message_id = ${input.messageId}
          AND d.completed_at IS NULL
          AND m.status NOT IN ('delivered', 'undelivered', 'failed', 'expired')
          -- 'pending' is unclaimed. The second arm RECLAIMS a dispatch whose worker died holding the
          -- lease; without it a crash between claim and completion is unrecoverable.
          AND (
            d.status <> 'sending'
            OR d.leased_at IS NULL
            OR d.leased_at < now() - ${LEASE_TIMEOUT}::interval
          )
        FOR UPDATE OF d SKIP LOCKED
        LIMIT 1
      ), claimed AS (
        UPDATE message_dispatches d
        SET status = 'sending',
            attempts = d.attempts + 1,
            leased_at = now(),
            last_error = NULL,
            updated_at = now()
        FROM claim
        WHERE d.message_id = claim.message_id
        RETURNING d.message_id
      )
      SELECT m.id, m.application_id, m.environment_id, m.subject_id, m.body_pii_id,
             m.sender_id, m.status::text, m.encoding::text, m.segments, m.currency,
             m.delivery_mode
      FROM messages m
      JOIN claimed c ON c.message_id = m.id`,
  )) as Row[];
  const row = rows[0];
  // Nothing claimed: already finished, already terminal, or in flight under a fresh lease. Report the
  // message's own status so the caller neither sends nor invents a failure.
  if (!row) return unclaimedStatus(input);
  // No terminal-status re-check here: the claim's own predicate already excluded terminal messages and
  // completed dispatches, so a row reaching this point is one we hold and are cleared to send.

  const subjectId = row.subject_id ? String(row.subject_id) : null;
  const bodyPiiId = row.body_pii_id ? String(row.body_pii_id) : null;
  const [to, body] = await Promise.all([
    subjectId
      ? input.vault.readLatest(input.tenantId, subjectId, "phone")
      : Promise.resolve(null),
    bodyPiiId
      ? input.vault.read(input.tenantId, bodyPiiId)
      : Promise.resolve(null),
  ]);
  const deliveryMode: DeliveryMode =
    row.delivery_mode === "virtual" ? "virtual" : "live";
  const storedInput: SendInput = {
    tenantId: input.tenantId,
    applicationId: row.application_id ? String(row.application_id) : null,
    environmentId: row.environment_id ? String(row.environment_id) : null,
    to: to ?? "[unreadable]",
    senderId: String(row.sender_id),
    body: body ?? "[unreadable]",
    currency: String(row.currency),
    ...(subjectId ? { subjectId } : {}),
    ...(bodyPiiId ? { bodyPiiId } : {}),
    deliveryMode,
  };
  const prepared: PreparedSend = {
    messageId: String(row.id),
    encoding: row.encoding === "ucs2" ? "ucs2" : "gsm7",
    segments: Number(row.segments),
  };
  if (to === null || body === null) {
    return { kind: "unreadable", input: storedInput, prepared, deliveryMode };
  }
  return { kind: "ready", input: storedInput, prepared, deliveryMode };
}

export async function completeStoredDispatch(
  db: AppDb,
  tenantId: string,
  messageId: string,
): Promise<void> {
  await db.withTenant(
    tenantId,
    (tx) => tx`
      UPDATE message_dispatches
      SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE message_id = ${messageId} AND completed_at IS NULL`,
  );
}

export async function pendingDispatches(
  db: AppDb,
  tenantId: string,
  limit = 100,
): Promise<Array<{ messageId: string; deliveryMode: DeliveryMode }>> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT d.message_id, m.delivery_mode
      FROM message_dispatches d JOIN messages m ON m.id = d.message_id
      WHERE d.completed_at IS NULL
        AND d.available_at <= now()
        -- Skip dispatches a worker currently holds. Before the claim existed this filter would have
        -- been wrong to add (nothing marked in-flight, so everything looked recoverable); now a fresh
        -- lease means someone is mid-send, and re-enqueuing that is how a retry races the original.
        -- A STALE lease still comes back — that is the crash-recovery case.
        AND (
          d.status <> 'sending'
          OR d.leased_at IS NULL
          OR d.leased_at < now() - ${LEASE_TIMEOUT}::interval
        )
      ORDER BY d.available_at, d.message_id
      LIMIT ${limit}`,
  )) as Row[];
  return rows.map((row) => ({
    messageId: String(row.message_id),
    deliveryMode: row.delivery_mode === "virtual" ? "virtual" : "live",
  }));
}

/**
 * The status to report when the claim took nothing. Three different situations collapse here and all
 * mean "do not send": the dispatch is finished, the message is terminal, or another worker holds a
 * fresh lease. Reporting the message's OWN status keeps the caller from inventing a failure for a
 * message that is perfectly fine and simply not ours to send.
 *
 * A missing row is `failed` rather than an exception, matching the previous behaviour: a job for a
 * message that no longer exists is not a crash, it is nothing to do.
 */
async function unclaimedStatus(input: {
  db: AppDb;
  tenantId: string;
  messageId: string;
}): Promise<StoredDispatch> {
  const rows = (await input.db.withTenant(
    input.tenantId,
    (tx) => tx`
      SELECT status::text FROM messages WHERE id = ${input.messageId} LIMIT 1`,
  )) as Row[];
  const status = rows[0]?.status;
  if (!status) return { kind: "skip", status: "failed" };
  return { kind: "skip", status: String(status) as MessageStatus };
}
