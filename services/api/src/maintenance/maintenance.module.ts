import { Module } from "@nestjs/common";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { SmsModule } from "../sms/sms.module.js";
import { MaintenanceService } from "./maintenance.service.js";

/**
 * Scheduled money-correctness jobs (reservation sweeper + ledger invariant check). Needs the
 * provisioning connection (cross-tenant READ discovery, migration 0027) and SmsService (per-tenant
 * sweep mutation through the RLS-scoped engine). ScheduleModule.forRoot() is mounted once in
 * AppModule.
 */
@Module({
  imports: [ProvisioningDbModule, SmsModule],
  providers: [MaintenanceService],
})
export class MaintenanceModule {}
