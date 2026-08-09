import { invalidRequest } from "../http/api-error.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";

/**
 * The kill-switch gates every WhatsApp send passes, extracted from whatsapp.service.ts so the send,
 * managed-accept and dispatch paths share one definition rather than three drifting copies (and to
 * keep the service under the file-length guard).
 *
 * Availability posture: these READ control-plane state through KillSwitchService's TTL cache, which
 * serves last-known-good on a store failure (ARCHITECTURE Principle #7). A provisioning outage must
 * not fail every send; the wallet is what fails closed.
 */

export async function assertWhatsappSendingEnabled(
  killSwitch: KillSwitchService,
  tenantId: string,
): Promise<void> {
  if (await killSwitch.isPaused("platform.whatsapp_sending", tenantId)) {
    throw invalidRequest(
      "whatsapp_sending_paused",
      "WhatsApp sending is temporarily paused.",
    );
  }
}

/**
 * Why a send must not proceed right now, or null. The provider switch is only consulted in live mode:
 * a sandbox send never reaches the vendor, so pausing a vendor must not take the sandbox down with it.
 */
export async function whatsappDispatchBlockReason(
  deps: { killSwitch: KillSwitchService; runtime: WhatsappRuntimeService },
  tenantId: string,
  mode: "sandbox" | "live",
): Promise<string | null> {
  if (await deps.killSwitch.isPaused("platform.whatsapp_sending", tenantId)) {
    return "whatsapp_sending_paused";
  }
  if (mode === "live") {
    const resolved = await deps.runtime.resolve("live");
    if (
      await deps.killSwitch.isPaused(
        `provider.${resolved.provider.slug}`,
        tenantId,
      )
    ) {
      return "provider_unavailable";
    }
  }
  return null;
}
