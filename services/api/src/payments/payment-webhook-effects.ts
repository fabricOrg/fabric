import { randomUUID } from "node:crypto";
import type { Payment, ProvisioningDb, TenantTx } from "@app/db";
import { paymentAuthorizations } from "@app/db";

/**
 * Side effects of a cleared Paystack charge, split out of PaymentsService to hold the file-length
 * guard. Behaviour is identical to the inline versions — no logic change.
 */

/** The reusable-card fields Paystack returns alongside a successful charge. */
export interface WebhookAuthorization {
  readonly authorizationCode: string;
  readonly reusable?: boolean | undefined;
  readonly cardType?: string | undefined;
  readonly last4?: string | undefined;
  readonly expMonth?: string | undefined;
  readonly expYear?: string | undefined;
  readonly bank?: string | undefined;
}

/**
 * Store the tenant's reusable card (auto-top-up source + the Payment-method card the dashboard
 * shows). Latest reusable card wins; non-reusable auths (mobile money, say) are ignored.
 */
export async function captureReusableCard(
  provisioning: ProvisioningDb,
  payment: Payment,
  auth: WebhookAuthorization | undefined,
): Promise<void> {
  if (!auth?.reusable || !auth.cardType) return;
  const card = {
    authorizationCode: auth.authorizationCode,
    email: payment.email,
    cardType: auth.cardType,
    last4: auth.last4 ?? null,
    expMonth: auth.expMonth ?? null,
    expYear: auth.expYear ?? null,
    bank: auth.bank ?? null,
    reusable: true,
  };
  await provisioning.db
    .insert(paymentAuthorizations)
    .values({ tenantId: payment.tenantId, provider: "paystack", ...card })
    .onConflictDoUpdate({
      target: paymentAuthorizations.tenantId,
      set: { ...card, updatedAt: new Date() },
    });
}

/**
 * Complete the Lighthouse flow a `flow-` reference belongs to, now that its collection cleared.
 * A no-op for ordinary top-ups (no matching flow_records row). Runs in the SAME tenant transaction
 * as the wallet credit, so the flow never reads as complete without the money having moved.
 */
export async function completeFlowRecord(
  tx: TenantTx,
  payment: Payment,
): Promise<void> {
  const amount = {
    currency: payment.currency,
    minor: payment.amountMinor.toString(),
  };
  const entries = [
    {
      account: "payments:collection-clearing",
      label: "Customer collection",
      direction: "debit",
      amount,
    },
    {
      account: "wallet:available",
      label: "Tenant wallet",
      direction: "credit",
      amount,
    },
  ];
  await tx`
    UPDATE flow_records SET
      charge_status = 'done', charge_at = now(),
      charge_entries = ${JSON.stringify(entries)}::jsonb,
      notify_status = 'done', notify_message_id = ${`msg_${randomUUID().slice(0, 10)}`}, notify_at = now(),
      status = 'complete', updated_at = now()
    WHERE charge_reference = ${payment.reference} AND status <> 'complete'`;
}
