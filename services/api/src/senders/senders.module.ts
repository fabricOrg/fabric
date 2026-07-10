import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import {
  SendersAdminController,
  SendersController,
} from "./senders.controller.js";
import { SendersService } from "./senders.service.js";

/**
 * Sender-ID registry (E10): customer registration surface + staff review queue. SmsModule
 * imports this to enforce active senders on the live send path (E10-S4).
 */
@Module({
  imports: [ApiKeysModule, ProvisioningDbModule, AuditModule],
  controllers: [SendersController, SendersAdminController],
  providers: [SendersService, BffTokenGuard],
  exports: [SendersService],
})
export class SendersModule {}
