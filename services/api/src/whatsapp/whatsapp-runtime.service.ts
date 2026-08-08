import type { Creds, WhatsAppSenderPlugin } from "@app/integrations";
import { FakeWhatsAppProvider } from "@app/integrations/testing/whatsapp";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { PluginResolverService } from "../plugins/plugin-resolver.service.js";

export interface ResolvedWhatsappRuntime {
  readonly provider: WhatsAppSenderPlugin;
  readonly creds: Creds;
}

@Injectable()
export class WhatsappRuntimeService {
  private readonly sandbox = new FakeWhatsAppProvider();

  constructor(
    @Optional()
    @Inject(PluginResolverService)
    private readonly resolver?: PluginResolverService,
  ) {}

  async resolve(mode: "sandbox" | "live"): Promise<ResolvedWhatsappRuntime> {
    if (mode === "sandbox") {
      return { provider: this.sandbox, creds: {} };
    }
    const resolved = await this.resolver?.resolveWhatsapp("live");
    if (!resolved) {
      throw invalidRequest(
        "live_whatsapp_not_configured",
        "Live WhatsApp requires an active Meta Cloud provider with validated credentials.",
      );
    }
    return { provider: resolved.provider, creds: resolved.creds };
  }
}
