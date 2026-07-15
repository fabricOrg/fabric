import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { SmsTemplatesController } from "./sms-templates.controller.js";
import { SmsTemplatesService } from "./sms-templates.service.js";

@Module({
  imports: [ApiKeysModule],
  controllers: [SmsTemplatesController],
  providers: [SmsTemplatesService],
})
export class SmsTemplatesModule {}
