import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { MessagePreviewService } from "./message-preview.service.js";
import { MessagesController } from "./messages.controller.js";

/**
 * Public managed-messages module (SDK-003). Currently the preview surface. Imports ApiKeysModule for
 * ApiKeyGuard (API key / BFF tenant token auth). DbModule is @Global.
 */
@Module({
  imports: [ApiKeysModule],
  controllers: [MessagesController],
  providers: [MessagePreviewService],
  exports: [MessagePreviewService],
})
export class MessagesModule {}
