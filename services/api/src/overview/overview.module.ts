import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { OverviewController } from "./overview.controller.js";
import { OverviewService } from "./overview.service.js";

@Module({
  imports: [ApiKeysModule],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
