import {
  type AppDb,
  type Payment,
  type ProvisioningDb,
  payments,
} from "@app/db";
import { credit } from "@app/wallet";
import { eq } from "drizzle-orm";
import {
  captureReusableCard,
  completeFlowRecord,
  type WebhookAuthorization,
} from "./payment-webhook-effects.js";

export interface SettlementDeps {
  readonly provisioning: ProvisioningDb;
  readonly appDb: AppDb;
}

/**
 * Bank a charge the provider has confirmed: capture the card, credit the wallet, emit the event, and
 * mark the intent `success`.
 *
 * ONE implementation on purpose, reached from two directions. The webhook is the fast path, but a
 * webhook can be dropped, mis-signed, or refused by our own mode-binding guard — and a charge the
 * customer paid for that never credits is the worst failure this system has. So the auto-top-up
 * reconciler settles through here too, on `verifyCharge` evidence rather than a delivered webhook.
 * If these were separate implementations they would drift, and the drift would be in whether money
 * arrives.
 *
 * Safe to call twice: `credit` is idempotent on the reference, the outbox emits only when money
 * actually moved THIS call, and the status write is a no-op once it is already `success`.
 */
export async function settleSucceededPayment(
  deps: SettlementDeps,
  payment: Payment,
  authorization?: WebhookAuthorization | undefined,
): Promise<void> {
  await captureReusableCard(deps.provisioning, payment, authorization);

  // Credit under the tenant's RLS context; idempotent on the reference (topup-{uuid}).
  // idempotencyKey dedups a replay; referenceId is omitted — it's a uuid FK to messages, not
  // applicable to a top-up.
  await deps.appDb.withTenant(payment.tenantId, async (tx) => {
    const credited = await credit(tx, {
      currency: payment.currency,
      amountMinor: payment.amountMinor,
      idempotencyKey: payment.reference,
    });
    // Transactional outbox: emit only when money actually moved THIS call — a replay must not fan
    // out a duplicate event.
    if (!credited.replayed) {
      await tx`
        INSERT INTO outbox_events (tenant_id, event_type, payload)
        VALUES (
          current_setting('app.tenant_id')::uuid,
          'topup.succeeded',
          ${JSON.stringify({
            reference: payment.reference,
            amount_minor: payment.amountMinor.toString(),
            currency: payment.currency,
          })}::jsonb
        )`;
    }
    await completeFlowRecord(tx, payment);
  });

  await deps.provisioning.db
    .update(payments)
    .set({ status: "success", updatedAt: new Date() })
    .where(eq(payments.reference, payment.reference));
}
