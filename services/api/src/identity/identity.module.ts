import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { BffTokenGuard } from "./bff-token.guard.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { ProvisioningDbModule } from "./provisioning-db.module.js";

@Module({
  imports: [ApiKeysModule, ProvisioningDbModule],
  controllers: [IdentityController],
  providers: [IdentityService, BffTokenGuard],
})
export class IdentityModule {}
