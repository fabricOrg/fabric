import { Module } from "@nestjs/common";
import { ApiKeysModule } from "../api-keys/api-keys.module.js";
import { ApplicationsController } from "./applications.controller.js";
import { ApplicationsService } from "./applications.service.js";

/**
 * Applications feature module (ADR-0004). Provides the app/env management service + its controller.
 * Imports ApiKeysModule for OperatorOrTenantGuard (+ the ApiKeyGuard it delegates to) so the
 * controller serves both the staff/ops operator path and the customer dashboard's tenant-token
 * path. DbModule is @Global, so the service injects APP_DB without a re-import.
 */
@Module({
  imports: [ApiKeysModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
