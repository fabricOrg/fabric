import type { Creds, SmsSenderPlugin } from "@app/integrations";
import { ArkeselSmsProvider } from "@app/integrations";
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
  readonly sandboxProvider: SmsSenderPlugin;
}

export function buildSmsProviders(
  config: ConfigService,
  logger: Logger,
): ConfiguredSmsProviders {
  const sandboxProvider = new FakeProvider();
  if (config.get<string>("SMS_PROVIDER") !== "arkesel") {
    return { provider: new FakeProvider(), creds: undefined, sandboxProvider };
  }
  // Sandbox by default — real delivery needs ARKESEL_SANDBOX=false, a deliberate human-gated flip.
  const callbackUrl = dlrCallbackUrl(config);
  const creds: Creds = {
    apiKey: config.get<string>("ARKESEL_API_KEY") ?? "",
    senderId: config.get<string>("ARKESEL_SENDER_ID") ?? "",
    sandbox: config.get<string>("ARKESEL_SANDBOX") ?? "true",
    ...(callbackUrl ? { callbackUrl } : {}),
  };
  logger.log(
    `SMS provider: arkesel-sms (sandbox=${creds.sandbox}, dlr=${callbackUrl ? "on" : "off"})`,
  );
  return { provider: new ArkeselSmsProvider(), creds, sandboxProvider };
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
