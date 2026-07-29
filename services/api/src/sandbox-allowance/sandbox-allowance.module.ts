import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { SandboxAllowanceController } from "./sandbox-allowance.controller.js";
import { SandboxAllowanceService } from "./sandbox-allowance.service.js";

@Module({
  imports: [ApiKeysModule],
  controllers: [SandboxAllowanceController],
  providers: [SandboxAllowanceService],
  exports: [SandboxAllowanceService],
})
export class SandboxAllowanceModule {}
