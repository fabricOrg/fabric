import type { AutoTopupResponse, Currency } from "@app/contracts";
import {
  autoTopup,
  type ProvisioningDb,
  paymentAuthorizations,
  type TenantId,
} from "@app/db";
import { eq } from "drizzle-orm";

/**
 * The stored auto-top-up config plus whether a reusable card exists.
 *
 * `has_card` is read separately because enabling requires one: without it the dashboard would offer
 * a switch the API refuses.
 */
export async function readAutoTopup(
  provisioning: ProvisioningDb,
  tenantId: TenantId,
): Promise<AutoTopupResponse> {
  const [row] = await provisioning.db
    .select()
    .from(autoTopup)
    .where(eq(autoTopup.tenantId, tenantId))
    .limit(1);
  const [card] = await provisioning.db
    .select({ id: paymentAuthorizations.id })
    .from(paymentAuthorizations)
    .where(eq(paymentAuthorizations.tenantId, tenantId))
    .limit(1);
  return {
    has_card: Boolean(card),
    config: row
      ? {
          enabled: row.enabled,
          threshold_minor: row.thresholdMinor.toString(),
          top_up_minor: row.topUpMinor.toString(),
          // Constrained by accounts_billing_currency_chk and the same enum on the write path.
          currency: row.currency as Currency,
        }
      : null,
  };
}
