import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
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
  imports: [ApiKeysModule, ProvisioningDbModule, KillSwitchModule],
  controllers: [PaymentsController, PaystackWebhookController],
  providers: [PaymentsService, AutoTopupService],
  exports: [AutoTopupService], // SmsModule fires maybeAutoTopUp after each wallet debit
})
export class PaymentsModule {}
