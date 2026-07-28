import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { PluginCredentialsService } from "./plugin-credentials.service.js";
import { PluginRegistryController } from "./plugin-registry.controller.js";
import { PluginRegistryService } from "./plugin-registry.service.js";
import { PluginResolverService } from "./plugin-resolver.service.js";

/** Platform plugin registry — staff-managed provider instances + resolution/failover. */
@Module({
  // AuditModule: installing a vendor credential is a staff action that must leave a record.
  imports: [ProvisioningDbModule, AuditModule],
  controllers: [PluginRegistryController],
  providers: [
    PluginRegistryService,
    PluginResolverService,
    PluginCredentialsService,
    BffTokenGuard,
  ],
  // The resolver is exported so the send path can ask the CONTROL PLANE which provider handles a
  // dispatch, instead of reading SMS_PROVIDER at boot (ADR-0011).
  exports: [PluginRegistryService, PluginResolverService],
})
export class PluginsModule {}
