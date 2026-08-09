import type { WhatsappSendResponse } from "@app/contracts";
import type { AppDb } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import {
  isTerminalWhatsappStatus,
  settleResolvedOutcome,
} from "./whatsapp-settlement.js";

type Row = Record<string, unknown>;

export async function resolveWhatsappStatus(
  db: AppDb,
  runtime: {
    resolve(mode: "sandbox" | "live"): Promise<{
      provider: { billableStatuses: readonly WhatsappSendResponse["status"][] };
    }>;
  },
  input: {
    tenantId: string;
    messageRef: string;
    status: WhatsappSendResponse["status"];
    providerRef?: string;
    errorCode?: string;
    lookupBy?: "messageId" | "providerRef";
  },
): Promise<WhatsappSendResponse["status"]> {
  return db.withTenant(input.tenantId, async (tx) => {
    const lookupBy = input.lookupBy ?? "messageId";
    const rows = (await tx`
      SELECT id, status::text, status_rank, backing, application_id, environment_id
      FROM whatsapp_messages
      WHERE ${
        lookupBy === "providerRef"
          ? tx`provider_ref = ${input.messageRef}`
          : tx`id = ${input.messageRef}`
      }
      FOR UPDATE`) as Row[];
    const current = rows[0];
    if (!current) return "failed";
    const messageId = String(current.id);
    const prior = String(current.status) as WhatsappSendResponse["status"];
    if (isTerminalWhatsappStatus(prior)) return prior;
    if (STATUS_RANK[input.status] < Number(current.status_rank)) return prior;

    await settleResolvedOutcome(tx, {
      runtime,
      messageId,
      backing: String(current.backing),
      priorRank: Number(current.status_rank),
      nextStatus: input.status,
    });
    await tx`
      UPDATE whatsapp_messages SET status = ${input.status}, status_rank = ${STATUS_RANK[input.status]},
        provider_ref = COALESCE(${input.providerRef ?? null}, provider_ref),
        error_code = COALESCE(${input.errorCode ?? null}, error_code), updated_at = now()
      WHERE id = ${messageId}`;
    await tx`
      UPDATE whatsapp_dispatches
      SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE message_id = ${messageId}`;
    await tx`
      INSERT INTO outbox_events (
        tenant_id, application_id, environment_id, event_type, payload
      ) VALUES (
        current_setting('app.tenant_id')::uuid, ${String(current.application_id)},
        ${String(current.environment_id)}, 'message.updated',
        ${JSON.stringify({ message_id: messageId, channel: "whatsapp", status: input.status, previous_status: prior })}::jsonb
      )`;
    return input.status;
  });
}
