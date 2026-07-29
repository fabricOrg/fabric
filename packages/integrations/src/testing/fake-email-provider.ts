import type {
  Creds,
  EmailProviderResult,
  EmailSenderPlugin,
  HealthState,
  NormalizedEmail,
  RequestContext,
} from "../plugin.js";

/** Deterministic sandbox provider. Reserved local-parts select failures without external delivery. */
export class FakeEmailProvider implements EmailSenderPlugin {
  readonly slug = "sandbox-email";
  readonly capability = "email" as const;
  readonly version = "1.0.0";
  readonly billableStatuses = ["delivered"] as const;
  readonly configSchema = {};

  supports(_context: RequestContext): boolean {
    return true;
  }

  healthCheck(): Promise<HealthState> {
    return Promise.resolve({ status: "up" });
  }

  send(message: NormalizedEmail, _creds: Creds): Promise<EmailProviderResult> {
    const localPart = message.to.split("@", 1)[0]?.toLowerCase();
    if (localPart === "reject") {
      return Promise.resolve({
        status: "undelivered",
        providerRef: `sandbox-email-${message.messageId}`,
        errorCode: "sandbox_recipient_rejected",
      });
    }
    if (localPart === "fail") {
      return Promise.resolve({
        status: "failed",
        providerRef: `sandbox-email-${message.messageId}`,
        errorCode: "sandbox_provider_failure",
      });
    }
    return Promise.resolve({
      status: "delivered",
      providerRef: `sandbox-email-${message.messageId}`,
    });
  }
}
