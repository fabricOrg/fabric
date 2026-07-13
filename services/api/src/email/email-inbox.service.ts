import type { EmailContentResponse, EmailMessage } from "@app/contracts";
import type { AppDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";
import { PiiVaultService } from "../privacy/pii-vault.service.js";
import { hydrateEmailRows, parseEmailContent } from "./email-content.js";

type Row = Record<string, unknown>;

/**
 * Dashboard email surface, scoped to the workspace's current environment TYPE (sandbox|live) across
 * apps — the /v1/email routes require an application-scoped key, so the dashboard reads here instead.
 */
@Injectable()
export class EmailInboxService {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(PiiVaultService) private readonly vault: PiiVaultService,
  ) {}

  /** Metadata for every email in the tenant's environment of this type; body loads on demand. */
  async listForEnvironmentType(
    tenantId: string,
    environmentType: "sandbox" | "live",
  ): Promise<EmailMessage[]> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT m.id, m.subject_id, m.content_pii_id, m.status::text, m.provider_slug,
               m.error_code, m.created_at
        FROM email_messages m
        JOIN environments e ON e.id = m.environment_id
        WHERE e.type = ${environmentType}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 100`,
    )) as Row[];
    return hydrateEmailRows(this.vault, tenantId, rows);
  }

  /** Decrypted content for one email in this environment type — the sandbox viewer. */
  async getContent(
    tenantId: string,
    environmentType: "sandbox" | "live",
    messageId: string,
  ): Promise<EmailContentResponse> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT m.id, m.content_pii_id
        FROM email_messages m
        JOIN environments e ON e.id = m.environment_id
        WHERE m.id = ${messageId} AND e.type = ${environmentType}
        LIMIT 1`,
    )) as Row[];
    const row = rows[0];
    if (!row) throw notFound("email_not_found", "Email message not found.");
    const raw = row.content_pii_id
      ? await this.vault.read(tenantId, String(row.content_pii_id))
      : null;
    const content = parseEmailContent(raw);
    if (!content) {
      return {
        id: String(row.id),
        to: "[erased]",
        from: "[erased]",
        subject: "[erased]",
        text: null,
        html: null,
        erased: true,
      };
    }
    return {
      id: String(row.id),
      to: content.to,
      from: content.from,
      subject: content.subject,
      text: content.text ?? null,
      html: content.html ?? null,
      erased: false,
    };
  }
}
