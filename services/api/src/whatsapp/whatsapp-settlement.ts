import type { WhatsappSendResponse } from "@app/contracts";
import type { TenantTx } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import { commit, refund } from "@app/wallet";

export type WhatsappBacking = "wallet" | "sandbox_allowance";

export function isTerminalWhatsappStatus(
  status: WhatsappSendResponse["status"],
): boolean {
  return (
    status === "delivered" ||
    status === "failed" ||
    status === "undelivered" ||
    status === "expired"
  );
}

export function parseWhatsappBacking(value: string): WhatsappBacking {
  if (value === "wallet" || value === "sandbox_allowance") return value;
  throw new Error(
    `whatsapp_messages.backing holds an unsupported value: ${value}`,
  );
}

export async function settleWhatsappBacking(
  tx: TenantTx,
  input: {
    backing: WhatsappBacking;
    priorRank: number;
    nextStatus: WhatsappSendResponse["status"];
    messageId: string;
  },
): Promise<void> {
  if (input.backing === "sandbox_allowance") return;
  const reachedBillable =
    input.priorRank >= STATUS_RANK.accepted ||
    STATUS_RANK[input.nextStatus] >= STATUS_RANK.accepted;
  if (reachedBillable) {
    await commit(tx, {
      referenceId: input.messageId,
      idempotencyKey: `commit:${input.messageId}`,
    });
    return;
  }
  if (input.nextStatus === "failed" || input.nextStatus === "undelivered") {
    await refund(tx, {
      referenceId: input.messageId,
      idempotencyKey: `refund:${input.messageId}`,
    });
  }
}
