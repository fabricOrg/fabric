import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { WebhookDeliveryService } from "./webhook-delivery.service.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksService } from "./webhooks.service.js";

/**
 * Tenant webhooks (finding 8): /v1/webhooks CRUD (ApiKeyGuard) + the outbox delivery sweeper.
 * Emission is NOT here — domain writes insert outbox rows in their own transactions (engine
 * resolveMessage, payments credit); this module only manages endpoints and delivers.
 */
@Module({
  imports: [ApiKeysModule, ProvisioningDbModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookDeliveryService],
})
export class WebhooksModule {}
