import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminModule } from "./admin/admin.module.js";
import { ApiKeysModule } from "./api-keys/api-keys.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { DbModule } from "./db/db.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./identity/identity.module.js";
import { KillSwitchModule } from "./kill-switches/kill-switches.module.js";
import { MembersModule } from "./members/members.module.js";
import { PluginsModule } from "./plugins/plugins.module.js";
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
    DbModule,
    HealthModule,
    IdentityModule,
    AdminModule,
    AuditModule,
    KillSwitchModule,
    MembersModule,
    PluginsModule,
    ApiKeysModule,
    SmsModule,
    WalletModule,
  ],
})
export class AppModule {}
