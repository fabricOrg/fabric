import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { TokenPurchaseService } from "./token-purchase.service.js";
import { TokensController } from "./tokens.controller.js";

/**
 * Token entitlements (ADR-0010 Phase 2): buy a price-locked quantity of sends, and read what remains.
 * The hold/settle primitives the send path uses are plain functions injected into the engine, so they
 * need no provider here — only the purchase flow is a service.
 *
 * PaymentsModule imports this to branch the Paystack webhook on a `token-` reference.
 */
@Module({
  imports: [
    ApiKeysModule,
    ProvisioningDbModule,
    KillSwitchModule,
    PluginsModule,
  ],
  controllers: [TokensController],
  providers: [TokenPurchaseService],
  exports: [TokenPurchaseService],
})
export class TokensModule {}
