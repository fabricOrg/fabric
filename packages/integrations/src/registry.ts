import { ArkeselSmsProvider } from "./arkesel/provider.js";
import type { SmsSenderPlugin } from "./plugin.js";
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
