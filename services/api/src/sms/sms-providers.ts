import type { Creds, SmsSenderPlugin } from "@app/integrations";
import { ArkeselSmsProvider, VirtualPhoneProvider } from "@app/integrations";
import { FakeProvider } from "@app/integrations/testing";
import type { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";

/**
 * Provider wiring for SmsService (split out for the file-length guard). The CONFIGURED provider
 * is selected by SMS_PROVIDER (`fake` default, `arkesel` real Ghana vendor); the SANDBOX provider
 * is always the fake one — ADR-0002 F3 pins sandbox-plan tenants to it at the routing layer.
 */
export interface ConfiguredSmsProviders {
  readonly provider: SmsSenderPlugin;
  readonly creds: Creds | undefined;
  readonly virtualProvider: VirtualPhoneProvider;
  readonly legacySandboxProvider: FakeProvider;
  readonly liveReady: boolean;
  readonly liveReadinessReason: string | null;
}

export function buildSmsProviders(
  config: ConfigService,
  logger: Logger,
): ConfiguredSmsProviders {
  const virtualProvider = new VirtualPhoneProvider();
  const legacySandboxProvider = new FakeProvider();
  if (config.get<string>("SMS_PROVIDER") !== "arkesel") {
    const readiness = liveProviderReadiness(config);
    return {
      provider: legacySandboxProvider,
      creds: undefined,
      virtualProvider,
      legacySandboxProvider,
      liveReady: readiness.ready,
      liveReadinessReason: readiness.reason,
    };
  }
  // Sandbox by default — real delivery needs ARKESEL_SANDBOX=false, a deliberate human-gated flip.
  const callbackUrl = dlrCallbackUrl(config);
  const apiKey = config.get<string>("ARKESEL_API_KEY") ?? "";
  const senderId = config.get<string>("ARKESEL_SENDER_ID") ?? "";
  const sandbox = config.get<string>("ARKESEL_SANDBOX") ?? "true";
  const creds: Creds = {
    apiKey,
    senderId,
    sandbox,
    ...(callbackUrl ? { callbackUrl } : {}),
  };
  logger.log(
    `SMS provider: arkesel-sms (sandbox=${creds.sandbox}, dlr=${callbackUrl ? "on" : "off"})`,
  );
  const readiness = liveProviderReadiness(config);
  return {
    provider: new ArkeselSmsProvider(),
    creds,
    virtualProvider,
    legacySandboxProvider,
    liveReady: readiness.ready,
    liveReadinessReason: readiness.reason,
  };
}

export function assertLiveProviderReady(config: ConfigService): void {
  const readiness = liveProviderReadiness(config);
  if (!readiness.ready) {
    throw new Error(readiness.reason ?? "Live SMS is not configured.");
  }
}

function liveProviderReadiness(config: ConfigService): {
  ready: boolean;
  reason: string | null;
} {
  if ((config.get<string>("NODE_ENV") ?? process.env.NODE_ENV) === "test") {
    return { ready: true, reason: null };
  }
  if (config.get<string>("SMS_PROVIDER") !== "arkesel") {
    return {
      ready: false,
      reason: "Arkesel is not configured as the live SMS provider.",
    };
  }
  const apiKey = config.get<string>("ARKESEL_API_KEY") ?? "";
  if (!apiKey || apiKey === "REPLACE_ME") {
    return { ready: false, reason: "Arkesel credentials are not configured." };
  }
  if ((config.get<string>("ARKESEL_SANDBOX") ?? "true") !== "false") {
    return {
      ready: false,
      reason: "Arkesel carrier delivery is still in sandbox mode.",
    };
  }
  return { ready: true, reason: null };
}

/**
 * Build the Arkesel DLR callback URL from its base + the ingress token. Arkesel's callback is a
 * header-less GET, so the WebhookTokenGuard reads the token from `?token=`; we append it here so the
 * secret lives in ONE place (WEBHOOK_INGRESS_TOKEN) rather than being duplicated into the base URL.
 */
function dlrCallbackUrl(config: ConfigService): string | undefined {
  const base = config.get<string>("ARKESEL_DLR_CALLBACK_URL");
  if (!base) return undefined;
  const token = config.get<string>("WEBHOOK_INGRESS_TOKEN");
  if (!token) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}
