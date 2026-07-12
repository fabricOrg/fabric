import { Module } from "@nestjs/common";
import { OperatorTokenGuard } from "../api-keys/operator-token.guard.js";
import { ApplicationsController } from "./applications.controller.js";
import { ApplicationsService } from "./applications.service.js";

/**
 * Applications feature module (ADR-0004). Provides the app/env management service + its operator-
 * gated controller. DbModule is @Global, so the service injects APP_DB without a re-import.
 */
@Module({
  controllers: [ApplicationsController],
  providers: [ApplicationsService, OperatorTokenGuard],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
