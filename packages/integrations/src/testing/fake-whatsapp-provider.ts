import { z } from "zod";
import type {
  CanonicalDlr,
  Creds,
  HealthState,
  IncomingRequest,
  NormalizedWhatsAppTemplateMessage,
  ProviderResult,
  RequestContext,
  WhatsAppSenderPlugin,
  WhatsAppTemplateRecord,
} from "../plugin.js";

export class FakeWhatsAppProviderError extends Error {}

const fakeDlrSchema = z.object({
  providerRef: z.string().trim().min(1),
  status: z.literal("delivered"),
});

export class FakeWhatsAppProvider implements WhatsAppSenderPlugin {
  readonly slug = "sandbox-whatsapp";
  readonly capability = "whatsapp" as const;
  readonly version = "0.1.0";
  readonly billableStatuses = ["accepted"] as const;
  readonly configSchema = {};

  supports(_context: RequestContext): boolean {
    return true;
  }

  healthCheck(): Promise<HealthState> {
    return Promise.resolve({ status: "up" });
  }

  send(
    message: NormalizedWhatsAppTemplateMessage,
    _creds: Creds,
  ): Promise<ProviderResult> {
    return Promise.resolve({
      status: "accepted",
      providerRef: `fake-whatsapp-${message.messageId}`,
      raw: { fake: true, templateCategory: message.templateCategory },
    });
  }

  parseDlr(payload: unknown): CanonicalDlr {
    const parsed = fakeDlrSchema.safeParse(payload);
    if (!parsed.success) {
      throw new FakeWhatsAppProviderError(
        "unparseable fake WhatsApp DLR payload",
      );
    }
    return {
      providerRef: parsed.data.providerRef,
      status: "delivered",
      raw: payload,
    };
  }

  verifyWebhook(_req: IncomingRequest, _creds: Creds): boolean {
    return true;
  }

  listTemplates(_creds: Creds): Promise<readonly WhatsAppTemplateRecord[]> {
    return Promise.resolve([]);
  }
}
