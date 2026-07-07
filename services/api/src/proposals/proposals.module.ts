import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { ProposalController } from "./proposals.controller.js";
import { ProposalService } from "./proposals.service.js";

/** Maker-checker proposals — create / list / decide (audited, separation of duties enforced). */
@Module({
  imports: [ProvisioningDbModule, AuditModule],
  controllers: [ProposalController],
  providers: [ProposalService, BffTokenGuard],
})
export class ProposalsModule {}
