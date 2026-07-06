import { pluginActionRequestSchema } from "@app/contracts";
import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { invalidRequest, notFound } from "../http/api-error.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/**
 * Platform plugin registry — staff/internal control-plane (BffToken-guarded, called by the
 * admin-console server, never a browser). Global config; not tenant-scoped.
 */
@Controller("internal/plugins")
@UseGuards(BffTokenGuard)
export class PluginRegistryController {
  constructor(
    @Inject(PluginRegistryService)
    private readonly registry: PluginRegistryService,
  ) {}

  @Get()
  async list() {
    return { instances: await this.registry.list() };
  }

  @Post()
  async apply(@Body() body: unknown) {
    const parsed = pluginActionRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_plugin_action",
        "The plugin action request is invalid.",
      );
    }
    const updated = await this.registry.apply(
      parsed.data.id,
      parsed.data.action,
    );
    if (!updated) throw notFound("unknown_plugin", "Unknown plugin instance.");
    return updated;
  }
}
