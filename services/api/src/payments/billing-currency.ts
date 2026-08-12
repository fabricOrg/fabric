import { accounts, type ProvisioningDb, type TenantId } from "@app/db";
import { eq } from "drizzle-orm";
import { invalidRequest } from "../http/api-error.js";

/**
 * A charge may only be raised in the workspace's own billing currency.
 *
 * Settlement credits a ledger account in whatever currency was charged, and nothing can spend it:
 * every quote is priced in `billing_currency` and the send path rejects the mismatch. There is no
 * refund path in the product, so this must fail BEFORE money moves. The package-purchase path has
 * enforced the same rule all along (`commercial-offer-purchase.ts`); the wallet paths skipped it.
 *
 * Shared rather than inlined per call site: a top-up, a flow collection and auto-top-up all charge,
 * and a second copy is how one of them drifts.
 */
export async function assertBillingCurrency(
  provisioning: ProvisioningDb,
  tenantId: string,
  requested: string,
): Promise<void> {
  const [account] = await provisioning.db
    .select({ billingCurrency: accounts.billingCurrency })
    .from(accounts)
    .where(eq(accounts.id, tenantId as TenantId))
    .limit(1);
  if (!account) {
    throw invalidRequest("tenant_not_found", "Workspace not found.");
  }
  if (account.billingCurrency !== requested) {
    throw invalidRequest(
      "billing_currency_mismatch",
      `This workspace is billed in ${account.billingCurrency}.`,
      "currency",
    );
  }
}
