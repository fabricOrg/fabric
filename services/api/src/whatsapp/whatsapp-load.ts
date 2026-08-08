import type { WhatsappSendResponse } from "@app/contracts";
import type { AppDb } from "@app/db";
import type { PiiVaultService } from "../privacy/pii-vault.service.js";
import { parseWhatsappContent } from "./whatsapp-content.js";
import { isTerminalWhatsappStatus } from "./whatsapp-settlement.js";

type Row = Record<string, unknown>;

export type StoredWhatsappDispatch =
  | { kind: "skip"; status: WhatsappSendResponse["status"] }
  | { kind: "unreadable" }
  | {
      kind: "ready";
      content: NonNullable<ReturnType<typeof parseWhatsappContent>>;
      backing: "wallet" | "sandbox_allowance";
      providerSlug: string;
    };

export async function loadStoredWhatsapp(
  db: AppDb,
  vault: PiiVaultService,
  tenantId: string,
  messageId: string,
): Promise<StoredWhatsappDispatch> {
  const rows = (await db.withTenant(
    tenantId,
    (tx) => tx`
      SELECT m.status::text, m.content_pii_id, m.backing, m.provider_slug, d.completed_at
      FROM whatsapp_messages m JOIN whatsapp_dispatches d ON d.message_id = m.id
      WHERE m.id = ${messageId} LIMIT 1`,
  )) as Row[];
  const row = rows[0];
  if (!row) return { kind: "skip", status: "failed" };
  const status = String(row.status) as WhatsappSendResponse["status"];
  if (row.completed_at || isTerminalWhatsappStatus(status)) {
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
