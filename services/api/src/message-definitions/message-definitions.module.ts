import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { MessageDefinitionsController } from "./message-definitions.controller.js";
import { MessageDefinitionsService } from "./message-definitions.service.js";

/**
 * Managed message definitions feature module (SDK-003). Imports ApiKeysModule for
 * OperatorOrTenantGuard (dashboard-session / operator auth — never a runtime sk_* key) and
 * AuditModule for publish/archive audit records. DbModule is @Global.
 */
@Module({
  imports: [ApiKeysModule, AuditModule],
  controllers: [MessageDefinitionsController],
  providers: [MessageDefinitionsService],
  exports: [MessageDefinitionsService],
})
export class MessageDefinitionsModule {}
