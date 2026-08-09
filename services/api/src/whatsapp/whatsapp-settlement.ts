import type { MessageStatus, WhatsappSendResponse } from "@app/contracts";
import type { TenantTx } from "@app/db";
import { decideResolution } from "@app/domain";
import type { PlatformFaultCause } from "@app/integrations";
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

/**
 * WHY THIS DEFERS TO `decideResolution` RATHER THAN COMPARING RANKS.
 *
 * The first version asked `priorRank >= accepted || STATUS_RANK[nextStatus] >= accepted`, and every
 * terminal status shares rank 4 — `delivered`, `undelivered`, `failed` and `expired` alike. So a send
 * that FAILED counted as "reached billable", committed the reserve, and the refund below became dead
 * code. A real send caught it: an expired Meta token produced `failed` with no provider ref, and the
 * customer was charged GHS 0.30 for a message that never left. CLAUDE.md is explicit that
 * platform-caused failures are not silently charged.
 *
 * Rank measures PROGRESS, not billability, and it cannot tell "terminal because delivered" from
 * "terminal because it died". `@app/domain` owns that decision for every channel; SMS already uses it,
 * and `reachedBillable` there is derived from the PRIOR status alone — the new status must never be
 * allowed to vote itself billable.
 */
export async function settleWhatsappBacking(
  tx: TenantTx,
  input: {
    backing: WhatsappBacking;
    priorRank: number;
    nextStatus: WhatsappSendResponse["status"];
    messageId: string;
    billableStatuses: readonly MessageStatus[];
    platformFaultExemptions: readonly PlatformFaultCause[];
    faultCause?: PlatformFaultCause;
  },
): Promise<void> {
  if (input.backing === "sandbox_allowance") return;
  const billableFrom = input.billableStatuses[0] ?? "accepted";
  const decision = decideResolution({
    newStatus: input.nextStatus,
    reachedBillable: input.priorRank >= STATUS_RANK[billableFrom],
    billableStatuses: input.billableStatuses,
    platformFaultExemptions: input.platformFaultExemptions,
    faultCause: input.faultCause,
  });
  if (decision === "commit") {
    await commit(tx, {
      referenceId: input.messageId,
      idempotencyKey: `commit:${input.messageId}`,
    });
    return;
  }
  if (decision === "refund") {
    await refund(tx, {
      referenceId: input.messageId,
      idempotencyKey: `refund:${input.messageId}`,
    });
  }
}

/**
 * Resolve the message's provider and settle its backing.
 *
 * Lives here rather than in the service so the BILLING CONTRACT stays in one file: the adapter
 * declares what it bills for via `billableStatuses`, and nothing re-derives that from status ranks.
 *
 * `platformFaultExemptions` is empty on purpose. No `faultCause` is threaded from the adapter error
 * yet, so a populated list would imply a classification we do not compute — and the
 * terminal-without-billing rule already refunds a send the provider never accepted, which is the
 * behaviour that matters.
 */
export async function settleResolvedOutcome(
  tx: TenantTx,
  input: {
    runtime: {
      resolve(mode: "sandbox" | "live"): Promise<{
        provider: { billableStatuses: readonly MessageStatus[] };
      }>;
    };
    messageId: string;
    backing: string;
    priorRank: number;
    nextStatus: WhatsappSendResponse["status"];
  },
): Promise<void> {
  const backing = parseWhatsappBacking(input.backing);
  // Only a wallet-backed send has a reservation to settle; an allowance-backed one never reserved.
  if (backing === "sandbox_allowance") return;
  const resolved = await input.runtime.resolve("live");
  await settleWhatsappBacking(tx, {
    backing,
    priorRank: input.priorRank,
    nextStatus: input.nextStatus,
    messageId: input.messageId,
    billableStatuses: resolved.provider.billableStatuses,
    platformFaultExemptions: [],
  });
}
