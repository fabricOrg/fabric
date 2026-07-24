import type { EmailMessage } from "@app/contracts";
import type { AppDb } from "@app/db";
import { notFound } from "../http/api-error.js";
import { encodeCursor, type PageInput } from "../http/cursor.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import { hydrateEmailRows } from "./email-content.js";

/**
 * Read side of the application-scoped /v1/email surface (an app-scoped key names one environment id).
 * Kept out of email.service.ts for cohesion — these are pure query+hydrate helpers, no dispatch state.
 * The dashboard's cross-app, environment-TYPE reads live separately in EmailInboxService.
 */

type Row = Record<string, unknown>;

export interface EmailPageResult {
  messages: EmailMessage[];
  next_cursor: string | null;
}

export async function listEmails(
  db: AppDb,
  vault: PiiVaultService,
  tenantId: string,
  environmentId: string,
  page: PageInput,
): Promise<EmailPageResult> {
  // limit + 1 signals a further page; Postgres row-tuple comparison keeps the keyset exact.
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT id, subject_id, content_pii_id, status::text, provider_slug,
             error_code, created_at
      FROM email_messages
      WHERE environment_id = ${environmentId}
      ${
        page.before
          ? tx`AND (created_at, id) < (${page.before.createdAt}, ${page.before.id})`
          : tx``
      }
      ORDER BY created_at DESC, id DESC
      LIMIT ${page.limit + 1}`,
  )) as Row[];
  const hasMore = rows.length > page.limit;
  const visible = hasMore ? rows.slice(0, page.limit) : rows;
  const last = visible[visible.length - 1];
  return {
    messages: await hydrateEmailRows(vault, tenantId, visible),
    next_cursor:
      hasMore && last
        ? encodeCursor({
            createdAt:
              last.created_at instanceof Date
                ? last.created_at
                : new Date(String(last.created_at)),
            id: String(last.id),
          })
        : null,
  };
}

export async function getEmail(
  db: AppDb,
  vault: PiiVaultService,
  tenantId: string,
  environmentId: string,
  messageId: string,
): Promise<EmailMessage> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT id, subject_id, content_pii_id, status::text, provider_slug,
             error_code, created_at
      FROM email_messages
      WHERE id = ${messageId} AND environment_id = ${environmentId}
      LIMIT 1`,
  )) as Row[];
  if (!rows[0]) throw notFound("email_not_found", "Email message not found.");
  const message = (await hydrateEmailRows(vault, tenantId, rows))[0];
  if (!message) throw notFound("email_not_found", "Email message not found.");
  return message;
}
