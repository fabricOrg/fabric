import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { DlrController } from "./dlr.controller.js";
import { SmsController } from "./sms.controller.js";
import { SmsService } from "./sms.service.js";
import { WebhookTokenGuard } from "./webhook-token.guard.js";

/**
 * SMS HTTP surface (L5): POST /v1/sms/send (ApiKeyGuard) + POST /webhooks/dlr/:provider. Imports
 * ApiKeysModule so the guard (+ its ApiKeyService) is available to SmsController; PaymentsModule so
 * a send can fire the after-debit auto-top-up check.
 */
@Module({
  imports: [ApiKeysModule, PaymentsModule],
  controllers: [SmsController, DlrController],
  providers: [SmsService, WebhookTokenGuard],
})
export class SmsModule {}
