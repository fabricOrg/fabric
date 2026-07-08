import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { FlowsController } from "./flows.controller.js";
import { FlowsService } from "./flows.service.js";

/**
 * Transactions explorer (Lighthouse flow) — verify → charge → notify, one reconciled record.
 * APP_DB (tenant-scoped credit + flow_records) is global; ApiKeysModule provides the guard;
 * KillSwitchModule gates the charge (platform.payments).
 */
@Module({
  imports: [ApiKeysModule, KillSwitchModule],
  controllers: [FlowsController],
  providers: [FlowsService],
})
export class FlowsModule {}
