import { Module } from "@nestjs/common";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { PluginRegistryController } from "./plugin-registry.controller.js";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginResolverService } from "./plugin-resolver.service.js";

/** Platform plugin registry — staff-managed provider instances + resolution/failover. */
@Module({
  imports: [ProvisioningDbModule],
  controllers: [PluginRegistryController],
  providers: [PluginRegistryService, PluginResolverService, BffTokenGuard],
  // The resolver is exported so the send path can ask the CONTROL PLANE which provider handles a
  // dispatch, instead of reading SMS_PROVIDER at boot (ADR-0011).
  exports: [PluginRegistryService, PluginResolverService],
})
export class PluginsModule {}
