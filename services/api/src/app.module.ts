import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ApiKeysModule } from "./api-keys/api-keys.module.js";
import { DbModule } from "./db/db.module.js";
import { HealthModule } from "./health/health.module.js";
import { SmsModule } from "./sms/sms.module.js";

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
    ApiKeysModule,
    SmsModule,
  ],
})
export class AppModule {}
