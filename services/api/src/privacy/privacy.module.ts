import { Module } from "@nestjs/common";
import { DbModule } from "../db/db.module.js";
import { PiiVaultService } from "./pii-vault.service.js";

/**
 * PRIVACY (COMPLIANCE §5) — the PII vault and crypto-shred erasure. Exported because the send path
 * and the virtual phone both tokenize recipients through it; nothing else may store raw PII.
 */
@Module({
  imports: [DbModule],
  providers: [PiiVaultService],
  exports: [PiiVaultService],
})
export class PrivacyModule {}
