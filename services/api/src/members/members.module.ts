import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuditModule } from "../audit/audit.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import {
  createWorkosClient,
  WORKOS_CLIENT,
} from "../identity/workos-client.provider.js";
import { MembersController } from "./members.controller.js";
import { MembersService } from "./members.service.js";

/** Tenant team-member management (dashboard): list + invite (WorkOS org invitation + membership). */
@Module({
  imports: [ProvisioningDbModule, AuditModule],
  controllers: [MembersController],
  providers: [
    MembersService,
    BffTokenGuard,
    {
      provide: WORKOS_CLIENT,
      inject: [ConfigService],
      useFactory: createWorkosClient,
    },
  ],
})
export class MembersModule {}
