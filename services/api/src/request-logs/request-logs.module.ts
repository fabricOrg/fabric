import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ProvisioningDbModule } from "../identity/provisioning-db.module.js";
import { RequestLogInterceptor } from "./request-log.interceptor.js";
import { RequestLogService } from "./request-log.service.js";
import { RequestLogsController } from "./request-logs.controller.js";

/**
 * Request logs (W-B). Registers the global capture interceptor (APP_INTERCEPTOR — applies to every
 * route; it self-filters to customer sk_* traffic) + the query controller. Imports ApiKeysModule for
 * ApiKeyGuard; ProvisioningDbModule for the off-hot-path writer connection. APP_DB is @Global.
 */
@Module({
  imports: [ApiKeysModule, ProvisioningDbModule],
  controllers: [RequestLogsController],
  providers: [
    RequestLogService,
    { provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor },
  ],
  exports: [RequestLogService],
})
export class RequestLogsModule {}
