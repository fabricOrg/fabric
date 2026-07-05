import { Module } from "@nestjs/common";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { PluginRegistryController } from "./plugin-registry.controller.js";
import { PluginRegistryService } from "./plugin-registry.service.js";

/** Platform plugin registry — staff-managed provider instances + resolution/failover. */
@Module({
  imports: [ProvisioningDbModule],
  controllers: [PluginRegistryController],
  providers: [PluginRegistryService, BffTokenGuard],
  exports: [PluginRegistryService],
})
export class PluginsModule {}
