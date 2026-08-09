import type { WhatsappSendResponse } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import { parseWhatsappContent } from "./whatsapp-content.js";
import { isTerminalWhatsappStatus } from "./whatsapp-settlement.js";

type Row = Record<string, unknown>;

/**
 * How long a claimed dispatch may stay claimed before another worker may take it.
 *
 * The claim exists to stop a double-send: two workers on one Redis queue must not both call Meta for
 * the same message. But a claim with no expiry converts a crash into a permanent orphan — the row sits
 * at 'sending' forever with its wallet reserve neither committed nor refunded. This is the horizon at
 * which we prefer risking a duplicate over stranding money, and it is deliberately far longer than one
 * Meta call plus its retries, so a slow send is never stolen from a worker that is still working.
 *
 * Bound as a PARAMETER cast to interval, not interpolated into a quoted literal — postgres.js would
 * parameterise the placeholder and the surrounding quotes would make it a syntax error.
 */
const LEASE_TIMEOUT = "5 minutes";

export type StoredWhatsappDispatch =
  | { kind: "skip"; status: WhatsappSendResponse["status"] }
  | { kind: "unreadable" }
  | {
      kind: "ready";
      content: NonNullable<ReturnType<typeof parseWhatsappContent>>;
      backing: "wallet" | "sandbox_allowance";
      providerSlug: string;
    };

export async function claimStoredWhatsapp(
  db: AppDb,
  vault: PiiVaultService,
  tenantId: string,
  messageId: string,
): Promise<StoredWhatsappDispatch> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      WITH claim AS (
        SELECT d.message_id
        FROM whatsapp_dispatches d
        JOIN whatsapp_messages m ON m.id = d.message_id
        WHERE d.message_id = ${messageId}
          AND d.completed_at IS NULL
          -- 'pending' is a fresh dispatch; the second arm RECLAIMS one whose worker died holding the
          -- lease. Without it a crash between claim and resolve is unrecoverable (see LEASE_TIMEOUT).
          AND (
            d.status = 'pending'
            OR (
              d.status = 'sending'
              AND d.leased_at IS NOT NULL
              AND d.leased_at < now() - ${LEASE_TIMEOUT}::interval
            )
          )
          AND d.available_at <= now()
          AND m.status NOT IN ('delivered', 'failed', 'undelivered', 'expired')
        FOR UPDATE OF d SKIP LOCKED
        LIMIT 1
      ), dispatch_claim AS (
        UPDATE whatsapp_dispatches d
        SET status = 'sending',
            attempts = d.attempts + 1,
            leased_at = now(),
            last_error = NULL,
            updated_at = now()
        FROM claim
        WHERE d.message_id = claim.message_id
        RETURNING d.message_id
      )
      UPDATE whatsapp_messages m
      SET status = 'sending',
          status_rank = GREATEST(status_rank, 1),
          updated_at = now()
      FROM dispatch_claim
      WHERE m.id = dispatch_claim.message_id
      RETURNING m.status::text, m.content_pii_id, m.backing, m.provider_slug`,
  )) as Row[];
  const row = rows[0];
  if (!row) return loadSkippedStatus(db, tenantId, messageId);
  const status = String(row.status) as WhatsappSendResponse["status"];
  if (isTerminalWhatsappStatus(status)) {
    return { kind: "skip", status };
  }
  const raw = row.content_pii_id
    ? await vault.read(tenantId, String(row.content_pii_id))
    : null;
  if (!raw) return { kind: "unreadable" };
  const content = parseWhatsappContent(raw);
  if (!content) return { kind: "unreadable" };
  return {
    kind: "ready",
    content,
    backing: String(row.backing) === "wallet" ? "wallet" : "sandbox_allowance",
    providerSlug: String(row.provider_slug),
  };
}

export async function recordUnknownWhatsappDispatchOutcome(
  db: AppDb,
  tenantId: string,
  messageId: string,
  reason: string,
): Promise<void> {
  await db.withTenant(
    tenantId,
    (tx) => tx`
      UPDATE whatsapp_dispatches
      SET status = 'failed',
          last_error = ${reason},
          updated_at = now()
      WHERE message_id = ${messageId}
        AND completed_at IS NULL`,
  );
}

export async function pendingWhatsappDispatches(
  db: AppDb,
  tenantId: string,
  limit = 100,
): Promise<string[]> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT message_id FROM whatsapp_dispatches
      WHERE completed_at IS NULL
        AND available_at <= now()
        -- Both a never-started dispatch AND one abandoned mid-flight. This filter used to demand
        -- status = 'pending' alone, which meant a worker that died after claiming left the row
        -- invisible to this sweeper forever, with its reserve stuck. claimStoredWhatsapp re-checks the
        -- lease, so returning a stale one here cannot steal work from a live worker.
        AND (
          status = 'pending'
          OR (
            status = 'sending'
            AND leased_at IS NOT NULL
            AND leased_at < now() - ${LEASE_TIMEOUT}::interval
          )
        )
      ORDER BY available_at, message_id LIMIT ${limit}`,
  )) as Row[];
  return rows.map((row) => String(row.message_id));
}

async function loadSkippedStatus(
  db: AppDb,
  tenantId: string,
  messageId: string,
): Promise<StoredWhatsappDispatch> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT m.status::text
      FROM whatsapp_messages m
      LEFT JOIN whatsapp_dispatches d ON d.message_id = m.id
      WHERE m.id = ${messageId}
        AND (d.completed_at IS NOT NULL
          OR d.status <> 'pending'
          OR m.status IN ('delivered', 'failed', 'undelivered', 'expired'))
      LIMIT 1`,
  )) as Row[];
  const row = rows[0];
  if (!row) return { kind: "skip", status: "failed" };
  return {
    kind: "skip",
    status: String(row.status) as WhatsappSendResponse["status"],
  };
}
