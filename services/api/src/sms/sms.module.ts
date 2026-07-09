import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { DlrController } from "./dlr.controller.js";
import { SmsController } from "./sms.controller.js";
import { SmsService } from "./sms.service.js";
import { WebhookTokenGuard } from "./webhook-token.guard.js";

/**
 * SMS HTTP surface (L5): POST /v1/sms/send (ApiKeyGuard) + POST /webhooks/dlr/:provider. Imports
 * ApiKeysModule so the guard (+ its ApiKeyService) is available to SmsController; PaymentsModule so
 * a send can fire the after-debit auto-top-up check; KillSwitchModule to gate sending.
 */
@Module({
  imports: [ApiKeysModule, IdempotencyModule, PaymentsModule, KillSwitchModule],
  controllers: [SmsController, DlrController],
  providers: [SmsService, WebhookTokenGuard],
  // Exported for the maintenance module: the scheduled sweeper resolves stuck reservations
  // through SmsService (same EngineDeps + provider billing basis as the live send path).
  exports: [SmsService],
})
export class SmsModule {}
