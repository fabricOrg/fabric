import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { KillSwitchModule } from "../kill-switches/kill-switches.module.js";
import { PaymentsModule } from "../payments/payments.module.js";
import { FlowsController } from "./flows.controller.js";
import { FlowsService } from "./flows.service.js";

/**
 * Transactions explorer (Lighthouse flow) — verify → charge → notify, one reconciled record.
 * APP_DB (tenant-scoped flow_records) is global; ApiKeysModule provides the guard; KillSwitchModule
 * gates the charge; PaymentsModule supplies the Paystack customer-collection (charge step).
 */
@Module({
  imports: [ApiKeysModule, KillSwitchModule, PaymentsModule],
  controllers: [FlowsController],
  providers: [FlowsService],
})
export class FlowsModule {}
