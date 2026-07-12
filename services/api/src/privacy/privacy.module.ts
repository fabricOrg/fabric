import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { DbModule } from "../db/db.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { PiiErasureService } from "./pii-erasure.service.js";
import { PiiVaultService } from "./pii-vault.service.js";
import { PrivacyController } from "./privacy.controller.js";

/**
 * PRIVACY (COMPLIANCE §5/§6) — the PII vault, crypto-shred erasure, and the staff DSR surface that
 * makes erasure reachable. A capability with no trigger is not shipped; the controller is the
 * trigger. PiiVaultService is exported because the send path and the virtual phone tokenize
 * recipients through it; nothing else may store raw PII.
 */
@Module({
  imports: [DbModule, AuditModule],
  controllers: [PrivacyController],
  providers: [PiiVaultService, PiiErasureService, BffTokenGuard],
  exports: [PiiVaultService, PiiErasureService],
})
export class PrivacyModule {}
