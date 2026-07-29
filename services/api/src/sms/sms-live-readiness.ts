import type { ConfigService } from "@nestjs/config";
import { invalidRequest } from "../http/api-error.js";
import type { PluginResolverService } from "../plugins/plugin-resolver.service.js";
import { assertLiveProviderReady } from "./sms-providers.js";

/**
 * Prove that live SMS has a usable carrier before a workspace may switch out of the virtual phone.
 * The control-plane plugin is authoritative; environment variables are only a migration fallback.
 */
export async function assertLiveSmsConfigured(
  pluginResolver: PluginResolverService,
  config: ConfigService,
): Promise<void> {
  let pluginReady: boolean;
  try {
    pluginReady = (await pluginResolver.resolveSms("live")) !== null;
  } catch {
    // Fail closed without leaking control-plane/database details to a customer. A transient registry
    // failure must not approve a mode switch whose carrier cannot be proven.
    throw invalidRequest(
      "live_provider_not_ready",
      "Live SMS configuration is temporarily unavailable. Try again shortly.",
    );
  }
  if (pluginReady) return;

  try {
    // Migration fallback only. Render intentionally keeps SMS_PROVIDER=fake; a configured live
    // plugin above is therefore sufficient and must not be rejected by this legacy gate.
    assertLiveProviderReady(config);
  } catch (error) {
    throw invalidRequest(
      "live_provider_not_ready",
      error instanceof Error ? error.message : "Live SMS is not configured.",
    );
  }
}
