import type { TenantTx } from "@app/db";
import type { MessageStatus } from "@app/integrations";

type Row = Record<string, unknown>;

export async function reconcileManagedEmailTerminal(
  tx: TenantTx,
  input: {
    messageId: string;
    newStatus: MessageStatus;
    errorCode?: string;
  },
): Promise<void> {
  const attempts = (await tx`
    SELECT a.delivery_id, a.application_id, a.environment_id
    FROM message_delivery_attempts a
    JOIN email_messages m ON m.id = a.email_message_id
    WHERE a.email_message_id = ${input.messageId}
    LIMIT 1`) as Row[];
  const attempt = attempts[0];
  if (!attempt) return;

  await tx`
    UPDATE message_delivery_attempts SET
      status = ${input.newStatus},
      error_code = COALESCE(${input.errorCode ?? null}, error_code),
      provider_accepted_at = CASE
        WHEN ${input.newStatus} IN ('sent', 'delivered', 'undelivered')
          THEN COALESCE(provider_accepted_at, now())
        ELSE provider_accepted_at
      END,
      updated_at = now()
    WHERE email_message_id = ${input.messageId}`;
  await tx`
    UPDATE message_deliveries SET
      status = ${input.newStatus},
      resource_version = resource_version + 1,
      updated_at = now()
    WHERE id = ${String(attempt.delivery_id)}`;
  // The caller already emits message.updated; managed email message_id equals delivery_id.
}
