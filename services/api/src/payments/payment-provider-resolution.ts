import { accounts, type ProvisioningDb } from "@app/db";
import type { Creds, PaymentProviderPlugin } from "@app/integrations";
import { PaystackProvider } from "@app/integrations";
import type { ConfigService } from "@nestjs/config";
import { eq } from "drizzle-orm";
import { invalidRequest } from "../http/api-error.js";
import type { PluginResolverService } from "../plugins/plugin-resolver.service.js";

/** A payment processor plus the credentials and mode it was resolved for. */
export interface ResolvedPaymentContext {
  readonly provider: PaymentProviderPlugin;
  readonly creds: Creds;
  readonly mode: "sandbox" | "live";
}

export interface PaymentResolutionDeps {
  readonly provisioning: ProvisioningDb;
  readonly config: ConfigService;
  readonly resolver?: PluginResolverService | undefined;
}

/**
 * Which credentials a workspace charges with. A `sandbox` plan resolves the instance holding test
 * keys; anything else resolves live keys.
 *
 * Plan rather than application-environment because a wallet top-up is WORKSPACE-level — it funds the
 * whole account, not one application's environment. (A send is different: it carries the environment
 * the API key belongs to, which is why SMS routes on that instead.)
 */
export async function paymentModeFor(
  provisioning: ProvisioningDb,
  tenantId: string,
): Promise<"sandbox" | "live"> {
  const [account] = await provisioning.db
    .select({ plan: accounts.plan })
    .from(accounts)
    .where(eq(accounts.id, tenantId as never))
    .limit(1);
  // Unknown tenant resolves to sandbox: the safe direction is test keys, never live ones.
  return account?.plan && account.plan !== "sandbox" ? "live" : "sandbox";
}

/**
 * The processor for this workspace's charges. CONTROL PLANE first, exactly as SMS resolves
 * (ADR-0011); `PAYSTACK_SECRET_KEY` is only the migration fallback and is deleted once a real
 * payment has proven the plugin path.
 *
 * Throws the same structured `payments_not_configured` either way, so the surface a customer sees
 * does not change with where the credential came from.
 */
export async function resolvePaymentContext(
  deps: PaymentResolutionDeps,
  tenantId: string,
): Promise<ResolvedPaymentContext> {
  const mode = await paymentModeFor(deps.provisioning, tenantId);
  const resolved = await deps.resolver?.resolvePayment(mode);
  if (resolved) {
    return { provider: resolved.provider, creds: resolved.creds, mode };
  }
  const secretKey = deps.config.get<string>("PAYSTACK_SECRET_KEY");
  if (!secretKey) {
    throw invalidRequest(
      "payments_not_configured",
      "Payments are not configured.",
    );
  }
  return { provider: new PaystackProvider(), creds: { secretKey }, mode };
}

/**
 * Every credential a Paystack webhook could legitimately be signed with.
 *
 * A webhook carries no tenant, and its signature must be verified BEFORE the body is trusted — so we
 * cannot read the reference to decide which key applies without trusting unverified input first.
 * Instead we try each configured key until one HMAC matches. That is constant work over a handful of
 * keys we own, and it gives an attacker nothing: forging still requires producing a valid HMAC under
 * one of them.
 *
 * Sandbox first only because test traffic is the more common case in a pre-launch platform; order
 * carries no security meaning, since a non-matching key simply fails.
 */
export async function webhookVerificationCandidates(
  deps: PaymentResolutionDeps,
): Promise<ResolvedPaymentContext[]> {
  const candidates: ResolvedPaymentContext[] = [];
  for (const mode of ["sandbox", "live"] as const) {
    const resolved = await deps.resolver?.resolvePayment(mode);
    if (resolved) {
      candidates.push({
        provider: resolved.provider,
        creds: resolved.creds,
        mode,
      });
    }
  }
  const secretKey = deps.config.get<string>("PAYSTACK_SECRET_KEY");
  if (secretKey) {
    // Migration fallback: an env-configured key must still verify its own in-flight webhooks while
    // the control plane is being populated.
    candidates.push({
      provider: new PaystackProvider(),
      creds: { secretKey },
      mode: "sandbox",
    });
  }
  return candidates;
}
