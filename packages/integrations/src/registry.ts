import { ArkeselSmsProvider } from "./arkesel/provider.js";
import type { SmsSenderPlugin } from "./plugin.js";

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
 * Vendors this build can actually route to. A catalog row for a vendor missing here is a plugin
 * staff can see and enable but that cannot dispatch — the registry answers "which of these are
 * real?" so the control plane can say so rather than failing at send time.
 */
export function supportedSmsVendors(): readonly string[] {
  return Object.keys(SMS_ADAPTERS);
}
