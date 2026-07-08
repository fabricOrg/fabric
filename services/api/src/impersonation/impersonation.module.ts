import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ImpersonationController } from "./impersonation.controller.js";

/** Impersonation audit trail (start/stop). The claim cookie is managed by the admin-console BFF. */
@Module({
  imports: [AuditModule],
  controllers: [ImpersonationController],
  providers: [BffTokenGuard],
})
export class ImpersonationModule {}
