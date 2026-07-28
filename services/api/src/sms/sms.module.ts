import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { ConsentModule } from "../consent/consent.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PluginsModule } from "../plugins/plugins.module.js";
import { PricingModule } from "../pricing/pricing.module.js";
import { PrivacyModule } from "../privacy/privacy.module.js";
import { QueueModule } from "../queue/queue.module.js";
import { SendersModule } from "../senders/senders.module.js";
import { DlrController } from "./dlr.controller.js";
import { MessagingInsightsService } from "./messaging-insights.service.js";
import { SmsController } from "./sms.controller.js";
import { SmsService } from "./sms.service.js";
import { SmsBatchController } from "./sms-batch.controller.js";
import { SmsBatchService } from "./sms-batch.service.js";
import { SmsRuntimeService } from "./sms-runtime.service.js";
import { SmsSendWorker } from "./sms-send.worker.js";
import { VirtualPhoneController } from "./virtual-phone.controller.js";
import { VirtualPhoneService } from "./virtual-phone.service.js";
import { WebhookTokenGuard } from "./webhook-token.guard.js";

/**
 * SMS HTTP surface (L5): POST /v1/sms/send (ApiKeyGuard) + POST /webhooks/dlr/:provider.
 * ApiKeysModule supplies the API-key guard and KillSwitchModule gates sending.
 */
@Module({
  imports: [
    ApiKeysModule,
    AuditModule,
    IdempotencyModule,
    KillSwitchModule,
    // ADR-0010: the send path prices against the account's resolved price book.
    PricingModule,
    // ADR-0011: which provider carries a live send is control-plane config, resolved per send
    // through a TTL cache — not SMS_PROVIDER read once at boot.
    PluginsModule,
    QueueModule,
    // E10-S4: the live send path enforces active sender-id registrations.
    SendersModule,
    // E10-S5: DND/consent + promotional quiet hours on the same path.
    ConsentModule,
    // COMPLIANCE §5: recipients are tokenized into the PII vault before a message row exists —
    // `messages` and `virtual_deliveries` reference a subject_id surrogate, never a raw number.
    PrivacyModule,
  ],
  controllers: [
    SmsController,
    SmsBatchController,
    DlrController,
    VirtualPhoneController,
  ],
  // SmsSendWorker consumes the sms-send queue in-process when REDIS_QUEUE_URL is set.
  providers: [
    SmsService,
    SmsBatchService,
    SmsRuntimeService,
    SmsSendWorker,
    WebhookTokenGuard,
    BffTokenGuard,
    VirtualPhoneService,
    MessagingInsightsService,
  ],
  // Exported for the maintenance module: the scheduled sweeper resolves stuck reservations
  // through SmsService (same EngineDeps + provider billing basis as the live send path).
  exports: [SmsService, VirtualPhoneService],
})
export class SmsModule {}
