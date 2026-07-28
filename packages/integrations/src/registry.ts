import { ArkeselSmsProvider } from "./arkesel/provider.js";
import { PaystackProvider } from "./paystack/provider.js";
import type { PaymentProviderPlugin, SmsSenderPlugin } from "./plugin.js";
import { FakeProvider } from "./testing/fake-provider.js";
import { VirtualPhoneProvider } from "./virtual-phone/provider.js";

/**
 * VENDOR → ADAPTER (ADR-0011). The one place that maps a `plugin_instances.vendor` string onto a
 * concrete adapter.
 *
 * Provider selection used to be a hardcoded `if (SMS_PROVIDER !== "arkesel")` in the api, so adding
 * a carrier meant editing the send path. With this map, adding one is: implement the adapter, add a
 * line here, insert a catalog row. Nothing in `services/api/src/sms` learns a vendor name.
 *
 * Factories, not instances: adapters are cheap and stateless, and constructing per resolution keeps
 * one request's provider from sharing mutable state with another's. The FAKE provider is
 * deliberately absent — it lives in `@app/integrations/testing` and is reachable only through the
 * sandbox/virtual path, never by resolving a vendor name, so no control-plane row can route live
 * traffic to something that fabricates success.
 */
export type SmsAdapterFactory = () => SmsSenderPlugin;

const SMS_ADAPTERS: Readonly<Record<string, SmsAdapterFactory>> = {
  arkesel: () => new ArkeselSmsProvider(),
};

/** The adapter for a vendor, or null when the registry has no implementation for it. */
export function smsAdapterFor(vendor: string): SmsAdapterFactory | null {
  return SMS_ADAPTERS[vendor.trim().toLowerCase()] ?? null;
}

/**
 * SLUG → ADAPTER, for RESOLUTION only — settling a message that was already dispatched.
 *
 * Keyed by `SmsSenderPlugin.slug` (what `prepare-send` stamps into `messages.provider_slug`), NOT by
 * the `plugin_instances.vendor` string `SMS_ADAPTERS` uses. The two identifiers genuinely differ:
 * vendor `arkesel` dispatches through slug `arkesel-sms`.
 *
 * WHY THIS MAP CONTAINS THE FAKE PROVIDER WHILE `SMS_ADAPTERS` DELIBERATELY DOES NOT — the two maps
 * answer different questions, and conflating them is a money bug in either direction:
 *
 *   - `SMS_ADAPTERS` answers "who should carry this NEW send?". The fake is absent so that no
 *     control-plane row can route live traffic to something that fabricates success.
 *   - This map answers "whose billing rules govern a message ALREADY SENT?". That message's fate is
 *     a historical fact recorded in `provider_slug`; refusing to look the adapter up would strand
 *     its reservation until the sweeper guessed with the wrong rules.
 *
 * Getting this wrong moves money. `billableStatuses` differs per adapter — `arkesel-sms` bills at
 * `accepted`, `virtual-phone` at `undelivered` — and its first entry is the STATUS_RANK threshold
 * `resolveMessage` uses to decide commit-vs-refund. Resolving an old message against whichever
 * provider the control plane happens to point at NOW can therefore commit a charge that should have
 * refunded. (Fault exemptions currently agree across adapters, so billing status is the whole
 * difference today — but it is per-adapter contract, not a constant, so this stays slug-keyed.)
 */
const SMS_RESOLUTION_ADAPTERS: Readonly<Record<string, SmsAdapterFactory>> = {
  "arkesel-sms": () => new ArkeselSmsProvider(),
  "virtual-phone": () => new VirtualPhoneProvider(),
  "fake-sms": () => new FakeProvider(),
};

/**
 * The adapter that dispatched a message, looked up by its stored `provider_slug`, or null when this
 * build has no implementation for it (a message sent by a since-removed adapter). Callers fall back
 * to their configured provider rather than failing the resolution — a stale slug must not strand a
 * reservation forever.
 */
export function smsResolutionAdapterFor(
  slug: string,
): SmsAdapterFactory | null {
  return SMS_RESOLUTION_ADAPTERS[slug.trim().toLowerCase()] ?? null;
}

/**
 * Vendors this build can actually route to. A catalog row for a vendor missing here is a plugin
 * staff can see and enable but that cannot dispatch — the registry answers "which of these are
 * real?" so the control plane can say so rather than failing at send time.
 */
export function supportedSmsVendors(): readonly string[] {
  return Object.keys(SMS_ADAPTERS);
}

/**
 * VENDOR → PAYMENT ADAPTER. Deliberately the same contract as SMS: the plugin system has to behave
 * identically whichever capability you configure, or staff learn a different set of rules per vendor.
 *
 * Payment credentials are per-MODE like everything else (slice 3's
 * `unique(tenant_id, capability, vendor, mode)`), which is what lets a sandbox instance hold
 * `sk_test_` while a live one holds `sk_live_` — two rows, not a flag on one.
 */
export type PaymentAdapterFactory = () => PaymentProviderPlugin;

const PAYMENT_ADAPTERS: Readonly<Record<string, PaymentAdapterFactory>> = {
  paystack: () => new PaystackProvider(),
};

/** The payment adapter for a vendor, or null when this build has no implementation for it. */
export function paymentAdapterFor(
  vendor: string,
): PaymentAdapterFactory | null {
  return PAYMENT_ADAPTERS[vendor.trim().toLowerCase()] ?? null;
}

/** Payment vendors this build can actually charge through. */
export function supportedPaymentVendors(): readonly string[] {
  return Object.keys(PAYMENT_ADAPTERS);
}

/**
 * The declared credential shape for ANY capability's vendor, or null when unknown.
 *
 * One lookup so `configure()` can validate every capability rather than only SMS. Without it a
 * Paystack instance could be saved carrying `apiKey` when its adapter requires `secretKey` — stored
 * successfully, fingerprinted, and unusable.
 */
export function adapterConfigSchemaFor(
  capability: string,
  vendor: string,
): Record<string, unknown> | null {
  if (capability === "sms") {
    return smsAdapterFor(vendor)?.().configSchema ?? null;
  }
  if (capability === "payment") {
    return paymentAdapterFor(vendor)?.().configSchema ?? null;
  }
  return null;
}

/**
 * Whether a credential CONTRADICTS the mode of the instance holding it — returns the reason, or null
 * when consistent.
 *
 * Presence checks are not enough, because for both vendors the credential itself carries a
 * live-vs-test switch that can disagree with the instance:
 *
 *   - **Arkesel** defaults to SANDBOX unless `sandbox === "false"` exactly. A live instance whose
 *     credential omits that flag is accepted by Arkesel, never forwarded to a carrier, and returns
 *     `accepted` — which is `billableStatuses[0]`, so the wallet reservation COMMITS. The customer is
 *     billed for a message that never left the building. That is fabricated success, and it is the
 *     precise failure this whole subsystem exists to prevent.
 *   - **Paystack** keys are prefixed. A sandbox instance holding `sk_live_…` makes REAL charges from
 *     what everyone believes is a test workspace; a live instance holding `sk_test_…` credits real
 *     wallets from payments that never happened.
 *
 * Enforced at configure time AND before activation, so neither ordering slips through.
 */
export function credentialModeViolation(
  capability: string,
  vendor: string,
  mode: "sandbox" | "live",
  credential: Readonly<Record<string, string>>,
): string | null {
  const key = vendor.trim().toLowerCase();
  if (capability === "sms" && key === "arkesel") {
    const sandboxed = credential.sandbox !== "false";
    if (mode === "live" && sandboxed) {
      return "A live instance requires sandbox='false'. Without it the provider accepts the message, never delivers it, and the send is still billed.";
    }
    if (mode === "sandbox" && !sandboxed) {
      return "A sandbox instance must not set sandbox='false' — that reaches real carriers and spends real money.";
    }
    return null;
  }
  if (capability === "payment" && key === "paystack") {
    const secret = credential.secretKey ?? "";
    if (mode === "live" && !secret.startsWith("sk_live_")) {
      return "A live instance requires a live secret key (sk_live_…).";
    }
    if (mode === "sandbox" && !secret.startsWith("sk_test_")) {
      return "A sandbox instance requires a test secret key (sk_test_…).";
    }
    return null;
  }
  return null;
}
