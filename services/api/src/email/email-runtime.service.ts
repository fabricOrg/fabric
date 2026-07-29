import type { Creds, EmailSenderPlugin } from "@app/integrations";
import { FakeEmailProvider } from "@app/integrations/testing/email";
import { Inject, Injectable, Optional } from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { PluginResolverService } from "../plugins/plugin-resolver.service.js";

export interface ResolvedEmailRuntime {
  readonly provider: EmailSenderPlugin;
  readonly creds: Creds;
}

@Injectable()
export class EmailRuntimeService {
  private readonly sandbox = new FakeEmailProvider();

  constructor(
    @Optional()
    @Inject(PluginResolverService)
    private readonly resolver?: PluginResolverService,
  ) {}

  async resolve(mode: "sandbox" | "live"): Promise<ResolvedEmailRuntime> {
    if (mode === "sandbox") {
      return { provider: this.sandbox, creds: {} };
    }
    const resolved = await this.resolver?.resolveEmail("live");
    if (!resolved) {
      throw invalidRequest(
        "live_email_not_configured",
        "Live Email requires an active provider with validated credentials.",
      );
    }
    return { provider: resolved.provider, creds: resolved.creds };
  }
}
