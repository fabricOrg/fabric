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
  /** Null on the env fallback, which has no control-plane instance behind it. */
  readonly instanceId: string | null;
  readonly credentialVersion: number | null;
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
/**
 * The mode a SECRET KEY belongs to — a different question from which mode a TENANT is in.
 *
 * The env fallback recorded the tenant's plan mode against the intent while the webhook side
 * hardcoded "sandbox" for that same key, so `webhookModeMismatch` refused every webhook it created:
 * a purchase by any non-sandbox tenant could never settle. Both sides now read the key, so they
 * agree by construction, and the property that matters still holds — a test key cannot settle an
 * intent created with a live one.
 */
export function modeForSecretKey(secretKey: string): "sandbox" | "live" {
  return secretKey.startsWith("sk_live_") ? "live" : "sandbox";
}

export async function resolvePaymentContext(
  deps: PaymentResolutionDeps,
  tenantId: string,
): Promise<ResolvedPaymentContext> {
  const mode = await paymentModeFor(deps.provisioning, tenantId);
  const resolved = await deps.resolver?.resolvePayment(mode);
  if (resolved) {
    return {
      provider: resolved.provider,
      creds: resolved.creds,
      mode,
      instanceId: resolved.instanceId,
      credentialVersion: resolved.credentialVersion,
    };
  }
  const secretKey = deps.config.get<string>("PAYSTACK_SECRET_KEY");
  if (!secretKey) {
    throw invalidRequest(
      "payments_not_configured",
      "Payments are not configured.",
    );
  }
  // The env fallback carries no instance or version — recorded as null so a webhook cannot be
  // required to match a binding that never existed. Its MODE describes the key, not the tenant:
  // the webhook that settles this intent will be verified with this same key.
  return {
    provider: new PaystackProvider(),
    creds: { secretKey },
    mode: modeForSecretKey(secretKey),
    instanceId: null,
    credentialVersion: null,
  };
}

/**
 * The signature only proves SOME key of ours signed it — not the right one. We hold both a test and
 * a live secret, and test keys circulate far more freely, so without this a webhook signed with the
 * test key could settle a live-mode reference and credit a real wallet.
 *
 * Intents created through the env fallback carry no mode and are exempt: there was no binding to
 * honour, and refusing them would break every in-flight charge during the migration.
 */
export function webhookModeMismatch(
  intentMode: string | null,
  verifiedMode: "sandbox" | "live",
): boolean {
  return intentMode !== null && intentMode !== verifiedMode;
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
  // Current AND immediately-previous credential per enabled instance: a charge created just before a
  // rotation must still have its webhook verified, or the payment strands unverifiable.
  for (const entry of (await deps.resolver?.paymentWebhookCredentials()) ??
    []) {
    candidates.push({
      provider: entry.provider,
      creds: entry.creds,
      mode: entry.mode,
      instanceId: entry.instanceId,
      credentialVersion: entry.version,
    });
  }
  const secretKey = deps.config.get<string>("PAYSTACK_SECRET_KEY");
  if (secretKey) {
    // Migration fallback: an env-configured key must still verify its own in-flight webhooks while
    // the control plane is being populated. Mode is null-equivalent here — intents it created carry
    // no binding, so nothing is enforced against them.
    candidates.push({
      provider: new PaystackProvider(),
      creds: { secretKey },
      mode: modeForSecretKey(secretKey),
      instanceId: null,
      credentialVersion: null,
    });
  }
  return candidates;
}
