import type { SendEmailApiResponse } from "@app/contracts";
import type { TenantTx } from "@app/db";
import { STATUS_RANK } from "@app/integrations";
import { commit, refund } from "@app/wallet";
import { settleTokenHolds } from "../tokens/token-settlement.js";
import { isTerminalEmailStatus } from "./email-content.js";

/**
 * The funding instruments an email can be settled against, mirroring `email_messages_backing_chk`.
 * This is a union rather than `string` so a future instrument cannot compile until it is settled
 * here — an unhandled one would silently strand a hold: never committed, never returned.
 */
export type EmailBacking = "wallet" | "tokens" | "sandbox_allowance";

/**
 * Narrow a stored `backing` value. The DB CHECK makes an unknown value unreachable, so reaching this
 * means the column drifted from the constraint; refuse loudly rather than skip settlement, which
 * would leave the reservation pending against money nobody resolves.
 */
export function parseEmailBacking(value: string): EmailBacking {
  if (
    value === "wallet" ||
    value === "tokens" ||
    value === "sandbox_allowance"
  ) {
    return value;
  }
  throw new Error(
    `email_messages.backing holds an unsupported value: ${value}`,
  );
}

/** Resolve exactly the funding instrument selected atomically when the email was accepted. */
export async function settleEmailBacking(
  tx: TenantTx,
  input: {
    backing: EmailBacking;
    priorRank: number;
    nextStatus: SendEmailApiResponse["status"];
    messageId: string;
  },
): Promise<void> {
  if (input.backing === "sandbox_allowance") return;
  const reachedBillable =
    input.priorRank >= STATUS_RANK.accepted ||
    STATUS_RANK[input.nextStatus] >= STATUS_RANK.accepted;
  if (input.backing === "wallet") {
    if (reachedBillable) {
      await commit(tx, {
        referenceId: input.messageId,
        idempotencyKey: `commit:${input.messageId}`,
      });
    } else if (isTerminalEmailStatus(input.nextStatus)) {
      await refund(tx, {
        referenceId: input.messageId,
        idempotencyKey: `refund:${input.messageId}`,
      });
    }
    return;
  }
  if (input.backing === "tokens") {
    if (reachedBillable) {
      await settleTokenHolds(tx, input.messageId, "committed");
    } else if (isTerminalEmailStatus(input.nextStatus)) {
      await settleTokenHolds(tx, input.messageId, "returned");
    }
    return;
  }
  // Exhaustiveness: adding an instrument to EmailBacking fails to compile until it settles above.
  const unhandled: never = input.backing;
  throw new Error(`Unhandled email backing: ${String(unhandled)}`);
}
