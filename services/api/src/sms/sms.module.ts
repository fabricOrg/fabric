import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { SendersModule } from "../senders/senders.module.js";
import { DlrController } from "./dlr.controller.js";
import { SmsController } from "./sms.controller.js";
import { SmsService } from "./sms.service.js";
import { SmsSendWorker } from "./sms-send.worker.js";
import { WebhookTokenGuard } from "./webhook-token.guard.js";

/**
 * SMS HTTP surface (L5): POST /v1/sms/send (ApiKeyGuard) + POST /webhooks/dlr/:provider. Imports
 * ApiKeysModule so the guard (+ its ApiKeyService) is available to SmsController; PaymentsModule so
 * a send can fire the after-debit auto-top-up check; KillSwitchModule to gate sending.
 */
@Module({
  imports: [
    ApiKeysModule,
    IdempotencyModule,
    PaymentsModule,
    KillSwitchModule,
    QueueModule,
    // E10-S4: the live send path enforces active sender-id registrations.
    SendersModule,
  ],
  controllers: [SmsController, DlrController],
  // SmsSendWorker consumes the sms-send queue in-process when REDIS_QUEUE_URL is set.
  providers: [SmsService, SmsSendWorker, WebhookTokenGuard],
  // Exported for the maintenance module: the scheduled sweeper resolves stuck reservations
  // through SmsService (same EngineDeps + provider billing basis as the live send path).
  exports: [SmsService],
})
export class SmsModule {}
