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

const E164 = /^\+[1-9]\d{7,14}$/;

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
  const sandbox = config.get<string>("ARKESEL_SANDBOX") ?? "true";
  const creds: Creds = {
    apiKey,
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
  // Reasons are user-facing (surfaced as the `live_provider_not_ready` API error): keep them
  // provider-neutral — never leak the carrier's name (Arkesel) to a customer.
  if (config.get<string>("SMS_PROVIDER") !== "arkesel") {
    return {
      ready: false,
      reason: "Live SMS delivery is not enabled for this environment.",
    };
  }
  const apiKey = config.get<string>("ARKESEL_API_KEY") ?? "";
  if (!apiKey || apiKey === "REPLACE_ME") {
    return {
      ready: false,
      reason: "Live SMS delivery is not enabled for this environment.",
    };
  }
  if ((config.get<string>("ARKESEL_SANDBOX") ?? "true") !== "false") {
    return {
      ready: false,
      reason: "Live SMS carrier delivery is still in sandbox mode.",
    };
  }
  const allowlist = parseLiveRecipientAllowlist(config);
  if (!allowlist.valid) {
    return {
      ready: false,
      reason: allowlist.reason,
    };
  }
  return { ready: true, reason: null };
}

/** A live Arkesel request is permitted only for explicitly verified E.164 recipients. */
export function isLiveRecipientAllowed(
  config: ConfigService,
  recipient: string,
): boolean {
  if (config.get<string>("SMS_PROVIDER") !== "arkesel") return true;
  if ((config.get<string>("ARKESEL_SANDBOX") ?? "true") !== "false") {
    return true;
  }
  const allowlist = parseLiveRecipientAllowlist(config);
  return allowlist.valid && allowlist.recipients.has(recipient);
}

function parseLiveRecipientAllowlist(
  config: ConfigService,
):
  | { valid: true; recipients: ReadonlySet<string> }
  | { valid: false; reason: string } {
  const raw = config.get<string>("SMS_LIVE_RECIPIENT_ALLOWLIST") ?? "";
  const recipients = raw
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    return {
      valid: false,
      reason: "The live SMS recipient allowlist is not configured.",
    };
  }
  if (recipients.some((recipient) => !E164.test(recipient))) {
    return {
      valid: false,
      reason:
        "The live SMS recipient allowlist contains an invalid E.164 number.",
    };
  }
  return { valid: true, recipients: new Set(recipients) };
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
