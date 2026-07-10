import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ConsentController } from "./consent.controller.js";
import { ConsentService } from "./consent.service.js";

/**
 * Consent / DND (E10-S5). SmsModule imports this: the send path blocks promo traffic to
 * opted-out recipients and outside the promotional window; "all"-scope suppresses everything.
 */
@Module({
  imports: [ApiKeysModule],
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService],
})
export class ConsentModule {}
