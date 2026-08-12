import type { Currency } from "@app/contracts";
import { accounts, type ProvisioningDb, type TenantId } from "@app/db";
import { eq } from "drizzle-orm";
import { invalidRequest, notFound } from "../http/api-error.js";

/**
 * A charge may only be raised in the workspace's own billing currency.
 *
 * Settlement credits a ledger account in whatever currency was charged, and nothing can spend it:
 * every quote is priced in `billing_currency` and the send path rejects the mismatch. There is no
 * refund path in the product, so this must fail BEFORE money moves. The package-purchase path has
 * enforced the same rule all along (`commercial-offer-purchase.ts`); the wallet paths skipped it.
 *
 * Shared rather than inlined per call site: a top-up, a flow collection and auto-top-up all charge,
 * and a second copy is how one of them drifts. Two pre-existing checks elsewhere
 * (`commercial-offer-purchase.ts`, `sms-effective-pricing.ts`) still carry their own codes and are
 * NOT folded in here; consolidating them is separate work.
 */
export async function billingCurrencyOf(
  provisioning: ProvisioningDb,
  tenantId: TenantId,
): Promise<Currency> {
  const [account] = await provisioning.db
    .select({ billingCurrency: accounts.billingCurrency })
    .from(accounts)
    .where(eq(accounts.id, tenantId))
    .limit(1);
  // The tenant id comes from an authenticated session, so a missing row is a server-side
  // inconsistency, not client input — 404 like every other tenant_not_found site, not 400.
  if (!account) throw notFound("tenant_not_found", "Workspace not found.");
  return account.billingCurrency as Currency;
}

/** Throwing form, for request paths. The cron uses `billingCurrencyOf` and skips instead. */
export async function assertBillingCurrency(
  provisioning: ProvisioningDb,
  tenantId: TenantId,
  requested: Currency,
): Promise<void> {
  const billing = await billingCurrencyOf(provisioning, tenantId);
  if (billing !== requested) {
    throw invalidRequest(
      "billing_currency_mismatch",
      `This workspace is billed in ${billing}.`,
      "currency",
    );
  }
}

/**
 * The billing currency, or null when a STORED value disagrees with it. Config rows and in-flight
 * intents both predate this rule, and charging one banks money into a ledger account nothing can
 * spend. Returns null rather than throwing: the auto-top-up caller swallows exceptions into a log
 * line, so throwing would simply become a charge attempt on every tick. The stored row is left
 * alone — disabling a customer's auto-top-up is their decision, and they can now save a correction.
 */
export async function chargeableCurrency(
  provisioning: ProvisioningDb,
  tenantId: TenantId,
  stored: string,
  label: string,
  logger: { error: (message: string) => void },
): Promise<Currency | null> {
  const billing = await billingCurrencyOf(provisioning, tenantId);
  if (stored === billing) return billing;
  logger.error(
    `auto-top-up ${label} for ${tenantId} is ${stored} but the workspace is billed in ${billing} — not charging`,
  );
  return null;
}
