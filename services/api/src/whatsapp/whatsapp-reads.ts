import type { MessageStatusGroup, WhatsappMessage } from "@app/contracts";
import type { AppDb } from "@app/db";
import { notFound } from "../http/api-error.js";
import { encodeCursor, type PageInput } from "../http/cursor.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import { hydrateWhatsappRows } from "./whatsapp-content.js";

type Row = Record<string, unknown>;

export interface WhatsappPageResult {
  messages: WhatsappMessage[];
  next_cursor: string | null;
}

export async function listWhatsappMessages(
  db: AppDb,
  vault: PiiVaultService,
  tenantId: string,
  environmentId: string,
  page: PageInput,
  status?: MessageStatusGroup,
): Promise<WhatsappPageResult> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT id, subject_id, status::text, provider_slug, template_name,
             template_language, template_category, error_code,
             cost_minor::text AS cost_minor, currency, created_at,
             to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_ts
      FROM whatsapp_messages
      WHERE environment_id = ${environmentId}
      ${statusClause(tx, status)}
      ${
        page.before
          ? tx`AND (created_at, id) < (${page.before.createdAt}::text::timestamptz, ${page.before.id})`
          : tx``
      }
      ORDER BY created_at DESC, id DESC
      LIMIT ${page.limit + 1}`,
  )) as Row[];
  const hasMore = rows.length > page.limit;
  const visible = hasMore ? rows.slice(0, page.limit) : rows;
  const last = visible[visible.length - 1];
  return {
    messages: await hydrateWhatsappRows(vault, tenantId, visible),
    next_cursor:
      hasMore && last
        ? encodeCursor({
            createdAt: String(last.cursor_ts),
            id: String(last.id),
          })
        : null,
  };
}

function statusClause(
  tx: Parameters<Parameters<AppDb["withTenant"]>[1]>[0],
  status: MessageStatusGroup | undefined,
) {
  if (status === "active") {
    return tx`AND status IN ('queued', 'sending', 'accepted', 'sent')`;
  }
  if (status === "delivered") return tx`AND status = 'delivered'`;
  if (status === "failed") {
    // `expired` is NOT a failure: it means no delivery report arrived within the TTL, and the
    // message stays billed. It has its own group so a customer is not told a message failed
    // when what actually happened is that we never heard back.
    return tx`AND status IN ('undelivered', 'failed')`;
  }
  if (status === "unknown") return tx`AND status = 'expired'`;
  // Exhaustive on purpose: adding a group without a clause here previously returned EVERY row
  // unfiltered, which reads as a working filter and is not one.
  if (status !== undefined) {
    const unhandled: never = status;
    throw new Error(`Unhandled message status group: ${String(unhandled)}`);
  }
  return tx``;
}

export async function getWhatsappMessage(
  db: AppDb,
  vault: PiiVaultService,
  tenantId: string,
  environmentId: string,
  messageId: string,
): Promise<WhatsappMessage> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT id, subject_id, status::text, provider_slug, template_name,
             template_language, template_category, error_code,
             cost_minor::text AS cost_minor, currency, created_at
      FROM whatsapp_messages
      WHERE id = ${messageId} AND environment_id = ${environmentId}
      LIMIT 1`,
  )) as Row[];
  if (!rows[0]) {
    throw notFound("whatsapp_not_found", "WhatsApp message not found.");
  }
  const message = (await hydrateWhatsappRows(vault, tenantId, rows))[0];
  if (!message) {
    throw notFound("whatsapp_not_found", "WhatsApp message not found.");
  }
  return message;
}
