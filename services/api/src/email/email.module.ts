import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PrivacyModule } from "../privacy/privacy.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { EmailController } from "./email.controller.js";
import { EmailService } from "./email.service.js";
import { EmailSendWorker } from "./email-send.worker.js";

@Module({
  imports: [
    ApiKeysModule,
    IdempotencyModule,
    ProvisioningDbModule,
    KillSwitchModule,
    PrivacyModule,
    QueueModule,
  ],
  controllers: [EmailController],
  providers: [EmailService, EmailSendWorker],
  exports: [EmailService],
})
export class EmailModule {}
