import {
  type AppDb,
  type Payment,
  type ProvisioningDb,
  payments,
  type TenantId,
} from "@app/db";
import type { Creds, PaymentProviderPlugin } from "@app/integrations";
import type { Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { settleSucceededPayment } from "./payment-settlement.js";

/** How long a never-submitted intent sits before we re-attempt the charge on its reference. */
const RETRY_AFTER_MS = 30_000;
/**
 * How long a SUBMITTED charge waits for its webhook before we ask the provider directly. Generous on
 * purpose: the webhook is the normal path and usually lands in seconds, so this only needs to be
 * short enough that a tenant is not blocked for long, and long enough that we are not calling verify
 * on charges that were about to settle anyway.
 */
const SUBMITTED_RECONCILE_MS = 10 * 60_000;

export interface ReconcileDeps {
  readonly provisioning: ProvisioningDb;
  readonly appDb: AppDb;
  readonly logger: Logger;
  readonly provider: PaymentProviderPlugin;
  readonly creds: Creds;
  readonly binding: {
    readonly mode: "sandbox" | "live";
    readonly instanceId: string | null;
    readonly credentialVersion: number | null;
  };
}

/**
 * What the caller should do after an insert lost to the per-tenant uniqueness guard: either stop
 * (the in-flight intent was handled, or is not ours to touch yet), or re-charge the intent that the
 * provider never received.
 */
export type ReconcileOutcome =
  | { readonly action: "stop" }
  | { readonly action: "recharge"; readonly payment: Payment };

/**
 * Resolve the single pending auto-top-up a tenant is allowed to have in flight.
 *
 * This exists because `payments.status` only ever leaves `pending` via the charge.success webhook —
 * and a webhook can be dropped, mis-signed, or refused outright by our own credential_mode_mismatch
 * guard. Without reconciliation the partial unique index blocks every future auto-top-up for that
 * tenant permanently, and a charge the customer already paid never reaches their wallet. The second
 * of those is much worse than the first.
 *
 * A SUBMITTED charge (providerRef present) is never re-charged — that risks a second debit. It is
 * settled or closed on the provider's own answer instead.
 */
export async function reconcilePendingAutoTopUp(
  deps: ReconcileDeps,
  tenantId: TenantId,
): Promise<ReconcileOutcome> {
  const [pending] = await deps.provisioning.db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.tenantId, tenantId),
        eq(payments.kind, "auto_topup"),
        eq(payments.status, "pending"),
      ),
    )
    .limit(1);
  if (!pending?.updatedAt) return { action: "stop" };

  const submitted = Boolean(pending.providerRef);
  const graceMs = submitted ? SUBMITTED_RECONCILE_MS : RETRY_AFTER_MS;
  if (Date.now() - pending.updatedAt.getTime() < graceMs) {
    return { action: "stop" };
  }
  // Refuse to act on an intent sealed under credentials we can no longer present: verifying or
  // charging it under a different key would be asking the wrong account about someone else's money.
  if (
    pending.providerMode !== deps.binding.mode ||
    pending.pluginInstanceId !== deps.binding.instanceId ||
    pending.credentialVersion !== deps.binding.credentialVersion
  ) {
    deps.logger.error(
      `Auto top-up ${pending.reference} requires an unavailable credential binding.`,
    );
    return { action: "stop" };
  }

  const verified = await deps.provider.verifyCharge(
    pending.reference,
    deps.creds,
  );
  if (verified?.status === "success") {
    // Settle through the SAME path the webhook uses — idempotent on the reference, so a webhook
    // arriving later is a no-op rather than a double credit.
    await settleSucceededPayment(
      { provisioning: deps.provisioning, appDb: deps.appDb },
      pending,
    );
    return { action: "stop" };
  }
  if (verified?.status === "pending") return { action: "stop" }; // still in flight
  if (verified?.status === "failed" || submitted) {
    // Terminal. A `submitted` charge the provider has no record of (verifyCharge → null on 404)
    // lands here too: we cannot re-charge a reference we believe reached it, so the honest move is
    // to close this intent and let the next check open a fresh one.
    await deps.provisioning.db
      .update(payments)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(payments.reference, pending.reference));
    return { action: "stop" };
  }
  // Never submitted and the provider has no record of it — safe to charge on the same reference,
  // which keeps this row as the single in-flight intent.
  return { action: "recharge", payment: pending };
}
