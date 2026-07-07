import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { KillSwitchController } from "./kill-switches.controller.js";
import { KillSwitchService } from "./kill-switches.service.js";

/** Platform kill switches — list + toggle (audited). AuditModule provides AuditService; the service
 *  is exported so runtime paths (send/charge) can check `isPaused`. */
@Module({
  imports: [ProvisioningDbModule, AuditModule],
  controllers: [KillSwitchController],
  providers: [KillSwitchService, BffTokenGuard],
  exports: [KillSwitchService],
})
export class KillSwitchModule {}
