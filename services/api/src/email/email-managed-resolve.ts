import type { TenantTx } from "@app/db";
import type { MessageStatus } from "@app/integrations";
import { commit, refund } from "@app/wallet";

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
    SELECT delivery_id, application_id, environment_id
    FROM message_delivery_attempts
    WHERE email_message_id = ${input.messageId}
    LIMIT 1`) as Row[];
  if (!attempts[0]) return;

  if (input.newStatus === "delivered") {
    await commit(tx, {
      referenceId: input.messageId,
      idempotencyKey: `commit:${input.messageId}`,
    });
  } else {
    await refund(tx, {
      referenceId: input.messageId,
      idempotencyKey: `refund:${input.messageId}`,
    });
  }

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
    WHERE id = ${String(attempts[0].delivery_id)}`;
  // The caller already emits message.updated; managed email message_id equals delivery_id.
}
