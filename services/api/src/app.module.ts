import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { AdminModule } from "./admin/admin.module.js";
import { ApiKeysModule } from "./api-keys/api-keys.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { DbModule } from "./db/db.module.js";
import { FlowsModule } from "./flows/flows.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { ImpersonationModule } from "./impersonation/impersonation.module.js";
import { KillSwitchModule } from "./kill-switches/kill-switches.module.js";
import { MaintenanceModule } from "./maintenance/maintenance.module.js";
import { MembersModule } from "./members/members.module.js";
import { PaymentsModule } from "./payments/payments.module.js";
import { PluginsModule } from "./plugins/plugins.module.js";
import { ProposalsModule } from "./proposals/proposals.module.js";
import { SmsModule } from "./sms/sms.module.js";
import { WalletModule } from "./wallet/wallet.module.js";

/**
 * Root module. ConfigModule (global) loads env (.env locally; Secrets Manager in cloud). DbModule
 * provides the app_runtime-backed AppDb (the tenant seam) globally. HealthModule exposes /health.
 * Feature modules (api-keys L2, wallet L3, sms L5) mount here as they land.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Registers the cron infrastructure for MaintenanceModule (sweeper + ledger invariant).
    ScheduleModule.forRoot(),
    DbModule,
    HealthModule,
    IdentityModule,
    AdminModule,
    AuditModule,
    FlowsModule,
    ImpersonationModule,
    KillSwitchModule,
    MaintenanceModule,
    MembersModule,
    PaymentsModule,
    PluginsModule,
    ProposalsModule,
    ApiKeysModule,
    SmsModule,
    WalletModule,
  ],
})
export class AppModule {}
