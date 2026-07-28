import type { DeliveryMode } from "@app/contracts";
import { invalidRequest } from "../http/api-error.js";
import type { KillSwitchService } from "../kill-switches/kill-switches.service.js";
import type { SmsRuntimeService } from "./sms-runtime.service.js";

/**
 * The pre-dispatch gate for a LIVE send (split out for the file-length guard).
 *
 * Both checks are async since ADR-0011, because both answers now come from the control plane rather
 * than from env read once at boot:
 *
 *   - readiness — a configured plugin instance makes the environment live-ready with no redeploy;
 *   - the kill-switch — it must gate the provider that will ACTUALLY carry this message, so the slug
 *     is resolved rather than derived from SMS_PROVIDER, which stops describing reality once the
 *     control plane owns selection.
 *
 * Virtual sends never reach here: they are pinned to the virtual phone and cannot touch a carrier.
 */
export async function assertLiveProviderAvailable(deps: {
  runtime: SmsRuntimeService;
  killSwitch: KillSwitchService;
  deliveryMode: DeliveryMode;
}): Promise<void> {
  if (deps.deliveryMode !== "live") return;

  const readiness = await deps.runtime.liveReadiness();
  if (!readiness.ready) {
    throw invalidRequest(
      "live_provider_not_ready",
      readiness.reason ?? "Live SMS is not configured.",
    );
  }
  const slug = await deps.runtime.providerSlug(deps.deliveryMode);
  if (await deps.killSwitch.isPaused(`provider.${slug}`)) {
    throw invalidRequest(
      "provider_unavailable",
      "The SMS provider is temporarily unavailable. Try again shortly.",
    );
  }
}
