import { createHmac } from "node:crypto";
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
} from "@app/integrations";

/**
 * A fake Meta Cloud plugin for template-lifecycle specs: two templates, one APPROVED and one PAUSED,
 * and a real HMAC check so webhook signature handling is exercised rather than stubbed past.
 *
 * Lives here rather than inside a spec because more than one spec needs the same catalog, and the
 * shared WABA is the point — a per-spec copy would let two suites disagree about what Meta returned.
 * `wabaId` is a constructor argument for the same reason: the WABA identifies the account, so a spec
 * asserting cross-tenant behaviour has to be able to hand two tenants the SAME one.
 */
export class WhatsappLifecycleProvider implements WhatsAppSenderPlugin {
  readonly slug = "meta-cloud";
  readonly capability = "whatsapp" as const;
  readonly version = "0.1.0";
  readonly billableStatuses = ["accepted"] as const;
  readonly configSchema = {};

  constructor(private readonly wabaId: string) {}

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
      providerRef: `wamid.${message.messageId}`,
      raw: { fake: true },
    });
  }

  parseDlr(_payload: unknown): CanonicalDlr {
    return { providerRef: "unused", status: "delivered" };
  }

  verifyWebhook(request: IncomingRequest, creds: Creds): boolean {
    const provided = request.headers["x-hub-signature-256"];
    if (!provided) return false;
    const hmac = createHmac("sha256", creds.app_secret ?? "");
    if (typeof request.rawBody === "string") {
      hmac.update(request.rawBody, "utf8");
    } else {
      hmac.update(request.rawBody);
    }
    return provided === `sha256=${hmac.digest("hex")}`;
  }

  listTemplates(_creds: Creds): Promise<readonly WhatsAppTemplateRecord[]> {
    return Promise.resolve([
      {
        wabaId: this.wabaId,
        name: "order_update",
        language: "en",
        category: "UTILITY",
        status: "APPROVED",
        qualityRating: "GREEN",
        components: [{ type: "BODY", text: "Hello {{1}}" }],
      },
      {
        wabaId: this.wabaId,
        name: "promo",
        language: "en",
        category: "MARKETING",
        status: "PAUSED",
        qualityRating: "YELLOW",
        components: [],
      },
    ]);
  }
}
