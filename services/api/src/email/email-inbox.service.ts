import type {
  EmailContentResponse,
  EmailInboxResponse,
  MessageStatusGroup,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import { Inject, Injectable } from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import { notFound } from "../http/api-error.js";
import {
  CURSOR_TS_FORMAT,
  encodeCursor,
  type PageInput,
} from "../http/cursor.js";
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
    page: PageInput,
    status?: MessageStatusGroup,
  ): Promise<EmailInboxResponse> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT m.id, m.subject_id, m.content_pii_id, m.status::text, m.provider_slug,
               m.error_code, m.created_at,
               to_char(m.created_at at time zone 'UTC', ${CURSOR_TS_FORMAT}) AS cursor_ts
        FROM email_messages m
        JOIN environments e ON e.id = m.environment_id
        WHERE e.type = ${environmentType}
        ${statusClause(tx, status)}
        ${
          page.before
            ? tx`AND (m.created_at, m.id) < (${page.before.createdAt}::text::timestamptz, ${page.before.id})`
            : tx``
        }
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${page.limit + 1}`,
    )) as Row[];
    const hasMore = rows.length > page.limit;
    const visible = hasMore ? rows.slice(0, page.limit) : rows;
    const last = visible[visible.length - 1];
    return {
      messages: await hydrateEmailRows(this.vault, tenantId, visible),
      next_cursor:
        hasMore && last
          ? encodeCursor({
              createdAt: String(last.cursor_ts),
              id: String(last.id),
            })
          : null,
    };
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

function statusClause(
  tx: Parameters<Parameters<AppDb["withTenant"]>[1]>[0],
  status: MessageStatusGroup | undefined,
) {
  if (status === "active") {
    return tx`AND m.status IN ('queued', 'sending', 'accepted', 'sent')`;
  }
  if (status === "delivered") return tx`AND m.status = 'delivered'`;
  if (status === "failed") {
    // `expired` is NOT a failure: no delivery report arrived within the TTL, and the message stays
    // billed. Reporting it as failed told a customer their message failed while charging for it.
    return tx`AND m.status IN ('undelivered', 'failed')`;
  }
  if (status === "unknown") return tx`AND m.status = 'expired'`;
  // Exhaustive on purpose: a group with no clause here previously returned EVERY row unfiltered,
  // which reads as a working filter and is not one.
  if (status !== undefined) {
    const unhandled: never = status;
    throw new Error(`Unhandled message status group: ${String(unhandled)}`);
  }
  return tx``;
}
