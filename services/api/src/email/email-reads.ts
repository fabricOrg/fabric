import type { EmailMessage } from "@app/contracts";
import type { AppDb } from "@app/db";
import { notFound } from "../http/api-error.js";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import { hydrateEmailRows } from "./email-content.js";

/**
 * Read side of the application-scoped /v1/email surface (an app-scoped key names one environment id).
 * Kept out of email.service.ts for cohesion — these are pure query+hydrate helpers, no dispatch state.
 * The dashboard's cross-app, environment-TYPE reads live separately in EmailInboxService.
 */

type Row = Record<string, unknown>;

export async function listEmails(
  db: AppDb,
  vault: PiiVaultService,
  tenantId: string,
  environmentId: string,
): Promise<EmailMessage[]> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT id, subject_id, content_pii_id, status::text, provider_slug,
             error_code, created_at
      FROM email_messages
      WHERE environment_id = ${environmentId}
      ORDER BY created_at DESC, id DESC
      LIMIT 100`,
  )) as Row[];
  return hydrateEmailRows(vault, tenantId, rows);
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
