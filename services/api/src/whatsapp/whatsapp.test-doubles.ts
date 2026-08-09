import type {
  Creds,
  NormalizedWhatsAppTemplateMessage,
  ProviderResult,
  WhatsAppSenderPlugin,
} from "@app/integrations";
import { MetaCloudError } from "@app/integrations";
import { FakeWhatsAppProvider } from "@app/integrations/testing/whatsapp";

/**
 * Provider test doubles for the WhatsApp integration spec, kept out of the spec itself so neither
 * file sprawls past the length guard.
 */

export function whatsappPayload() {
  return {
    to: "+233545227189",
    template_name: "order_update",
    template_language: "en",
    template_category: "utility" as const,
    variables: ["A123"],
    currency: "GHS" as const,
  };
}

/**
 * Fails the way an expired Meta token does: the adapter throws before any provider ref exists. A REAL
 * send hit this — the token lapsed mid-session and the customer was charged GHS 0.30 for a message
 * that never left, because the settlement compared status RANKS and every terminal status shares one.
 */
export class FailingWhatsAppProvider
  extends FakeWhatsAppProvider
  implements WhatsAppSenderPlugin
{
  override send(
    _message: NormalizedWhatsAppTemplateMessage,
    _creds: Creds,
  ): Promise<ProviderResult> {
    // The real adapter raises a STRUCTURED error for a 401, not a bare Error — a bare one escapes as a
    // 500 and would test the wrong thing entirely.
    return Promise.reject(
      new MetaCloudError(
        "whatsapp_provider_unavailable",
        "Authentication Error",
      ),
    );
  }
}

export class BlockingWhatsAppProvider
  extends FakeWhatsAppProvider
  implements WhatsAppSenderPlugin
{
  calls = 0;
  private releaseSend: (() => void) | undefined;
  readonly started: Promise<void>;
  private markStarted: () => void;

  constructor() {
    super();
    this.markStarted = () => {};
    this.started = new Promise<void>((resolve) => {
      this.markStarted = resolve;
    });
  }

  override async send(
    message: NormalizedWhatsAppTemplateMessage,
    _creds: Creds,
  ): Promise<ProviderResult> {
    this.calls++;
    this.markStarted();
    await new Promise<void>((resolve) => {
      this.releaseSend = resolve;
    });
    return {
      status: "accepted",
      providerRef: `blocked-whatsapp-${message.messageId}`,
      raw: { fake: true },
    };
  }

  release(): void {
    this.releaseSend?.();
  }
}
