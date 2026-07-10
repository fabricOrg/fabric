import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { SmsModule } from "../sms/sms.module.js";
import { VerifyController } from "./verify.controller.js";
import { VerifyService } from "./verify.service.js";

/**
 * Verify (OTP) HTTP surface (V1) — the golden path's headline product. Rides SmsModule's send
 * pipeline (billing, sandbox pinning, kill-switches inherited) and ApiKeysModule's guard.
 */
@Module({
  imports: [ApiKeysModule, SmsModule],
  controllers: [VerifyController],
  providers: [VerifyService],
})
export class VerifyModule {}
