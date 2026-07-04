import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { BffTokenGuard } from "./bff-token.guard.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { ProvisioningDbModule } from "./provisioning-db.module.js";
import { createWorkosClient, WORKOS_CLIENT } from "./workos-client.provider.js";
import { WorkosWebhookController } from "./workos-webhook.controller.js";
import { WorkosWebhookService } from "./workos-webhook.service.js";

@Module({
  imports: [ApiKeysModule, ProvisioningDbModule],
  controllers: [IdentityController, WorkosWebhookController],
  providers: [
    IdentityService,
    BffTokenGuard,
    WorkosWebhookService,
    {
      provide: WORKOS_CLIENT,
      inject: [ConfigService],
      useFactory: createWorkosClient,
    },
  ],
})
export class IdentityModule {}
