import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ConsentModule } from "../consent/consent.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { PrivacyModule } from "../privacy/privacy.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { SandboxAllowanceModule } from "../sandbox-allowance/sandbox-allowance.module.js";
import { WhatsappController } from "./whatsapp.controller.js";
import { WhatsappService } from "./whatsapp.service.js";
import { WhatsappRuntimeService } from "./whatsapp-runtime.service.js";
import { WhatsappSendWorker } from "./whatsapp-send.worker.js";

@Module({
  imports: [
    ApiKeysModule,
    ConsentModule,
    IdempotencyModule,
    ProvisioningDbModule,
    KillSwitchModule,
    PluginsModule,
    PricingModule,
    PrivacyModule,
    QueueModule,
    SandboxAllowanceModule,
  ],
  controllers: [WhatsappController],
  providers: [WhatsappService, WhatsappRuntimeService, WhatsappSendWorker],
  exports: [WhatsappService, WhatsappRuntimeService],
})
export class WhatsappModule {}
