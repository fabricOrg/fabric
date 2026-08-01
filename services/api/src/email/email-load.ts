import type { SendEmailApiResponse, SendEmailRequest } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import { isTerminalEmailStatus, parseEmailContent } from "./email-content.js";

type Row = Record<string, unknown>;

export type StoredEmailDispatch =
  | { kind: "skip"; status: SendEmailApiResponse["status"] }
  | { kind: "unreadable" }
  | {
      kind: "ready";
      content: SendEmailRequest;
      backing: "wallet" | "tokens" | "sandbox_allowance";
      providerSlug: string;
    };

export async function loadStoredEmail(
  db: AppDb,
  vault: PiiVaultService,
  tenantId: string,
  messageId: string,
): Promise<StoredEmailDispatch> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT m.status::text, m.content_pii_id, m.backing, m.provider_slug, d.completed_at
      FROM email_messages m JOIN email_dispatches d ON d.message_id = m.id
      WHERE m.id = ${messageId} LIMIT 1`,
  )) as Row[];
  const row = rows[0];
  if (!row) return { kind: "skip", status: "failed" };
  const status = String(row.status) as SendEmailApiResponse["status"];
  if (row.completed_at || isTerminalEmailStatus(status)) {
    return { kind: "skip", status };
  }
  const raw = row.content_pii_id
    ? await vault.read(tenantId, String(row.content_pii_id))
    : null;
  if (!raw) return { kind: "unreadable" };
  const content = parseEmailContent(raw);
  if (!content) return { kind: "unreadable" };
  const storedBacking = String(row.backing);
  const backing =
    storedBacking === "wallet" || storedBacking === "tokens"
      ? storedBacking
      : "sandbox_allowance";
  return {
    kind: "ready",
    content,
    backing,
    providerSlug: String(row.provider_slug),
  };
}
