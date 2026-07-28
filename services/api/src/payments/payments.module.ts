import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { TokensModule } from "../tokens/tokens.module.js";
import { AutoTopupService } from "./auto-topup.service.js";
import { PaymentsController } from "./payments.controller.js";
import { PaymentsService } from "./payments.service.js";
import { PaystackWebhookController } from "./paystack-webhook.controller.js";

/**
 * Wallet top-up (E4) — initiate a Paystack charge + process its webhook to credit the ledger.
 * APP_DB (tenant-scoped credit) is global; ApiKeysModule provides the guard; KillSwitchModule gates
 * new top-ups; ProvisioningDbModule backs the platform-level payments intents.
 */
@Module({
  imports: [
    ApiKeysModule,
    ProvisioningDbModule,
    KillSwitchModule,
    TokensModule,
    // ADR-0011: which processor and credentials a workspace charges with is control-plane config,
    // resolved per mode — sandbox workspaces on test keys, live ones on live keys.
    PluginsModule,
  ],
  controllers: [PaymentsController, PaystackWebhookController],
  providers: [PaymentsService, AutoTopupService],
  // AutoTopupService → SmsModule (after-debit trigger); PaymentsService → FlowsModule (collections).
  exports: [AutoTopupService, PaymentsService],
})
export class PaymentsModule {}
