import { Module } from "@nestjs/common";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";

/** Audit log — read endpoint + a service other modules inject to record consequential actions. */
@Module({
  imports: [ProvisioningDbModule],
  controllers: [AuditController],
  providers: [AuditService, BffTokenGuard],
  exports: [AuditService],
})
export class AuditModule {}
