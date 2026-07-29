import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { PrivacyModule } from "../privacy/privacy.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { SandboxAllowanceModule } from "../sandbox-allowance/sandbox-allowance.module.js";
import { EmailController } from "./email.controller.js";
import { EmailService } from "./email.service.js";
import { EmailInboxController } from "./email-inbox.controller.js";
import { EmailInboxService } from "./email-inbox.service.js";
import { EmailRuntimeService } from "./email-runtime.service.js";
import { EmailSendWorker } from "./email-send.worker.js";
import { SesEventsController } from "./ses-events.controller.js";

@Module({
  imports: [
    ApiKeysModule,
    IdempotencyModule,
    ProvisioningDbModule,
    KillSwitchModule,
    PluginsModule,
    PricingModule,
    PrivacyModule,
    QueueModule,
    SandboxAllowanceModule,
  ],
  controllers: [EmailController, EmailInboxController, SesEventsController],
  providers: [
    EmailService,
    EmailRuntimeService,
    EmailInboxService,
    EmailSendWorker,
  ],
  exports: [EmailService],
})
export class EmailModule {}
