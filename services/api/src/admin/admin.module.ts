import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import {
  createWorkosClient,
  WORKOS_CLIENT,
} from "../identity/workos-client.provider.js";
import { TenantProvisioningController } from "./tenant-provisioning.controller.js";
import { TenantProvisioningService } from "./tenant-provisioning.service.js";

/** Staff control-plane: ops-provisioned tenant onboarding (WorkOS org + account + admin invite). */
@Module({
  imports: [ProvisioningDbModule],
  controllers: [TenantProvisioningController],
  providers: [
    TenantProvisioningService,
    BffTokenGuard,
    {
      provide: WORKOS_CLIENT,
      inject: [ConfigService],
      useFactory: createWorkosClient,
    },
  ],
})
export class AdminModule {}
