import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ConsentModule } from "../consent/consent.module.js";
import { SendersModule } from "../senders/senders.module.js";
import { SmsModule } from "../sms/sms.module.js";
import { ManagedMessagesController } from "./managed-messages.controller.js";
import { ManagedMessagesService } from "./managed-messages.service.js";
import { MessagePreviewService } from "./message-preview.service.js";
import { MessagesController } from "./messages.controller.js";

/**
 * Public managed-messages module (SDK-003). Currently the preview surface. Imports ApiKeysModule for
 * ApiKeyGuard (API key / BFF tenant token auth). DbModule is @Global.
 */
@Module({
  imports: [ApiKeysModule, ConsentModule, SendersModule, SmsModule],
  controllers: [MessagesController, ManagedMessagesController],
  providers: [MessagePreviewService, ManagedMessagesService],
  exports: [MessagePreviewService],
})
export class MessagesModule {}
