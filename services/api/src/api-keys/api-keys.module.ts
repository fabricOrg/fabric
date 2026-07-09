import { Module } from "@nestjs/common";
import { RateLimitModule } from "../rate-limit/rate-limit.module.js";
import { ApiContextController } from "./api-context.controller.js";
import { ApiKeyGuard } from "./api-key.guard.js";
import { ApiKeysController } from "./api-keys.controller.js";
import { ApiKeyService } from "./api-keys.service.js";
import { OperatorTokenGuard } from "./operator-token.guard.js";

/**
 * API-keys feature module (F2.3, L2). Provides + exports the resolver/issuer service and the guard.
 * DbModule is @Global, so ApiKeyService injects APP_DB without a re-import. Protected controllers
 * import this module and apply ApiKeyGuard; the key-management controller (create/list/revoke) is
 * operator-token-gated separately until customer sessions land in F2.1.
 */
@Module({
  // RateLimitModule: ApiKeyGuard takes a token per request (per-key + per-tenant buckets).
  imports: [RateLimitModule],
  controllers: [ApiKeysController, ApiContextController],
  providers: [ApiKeyService, ApiKeyGuard, OperatorTokenGuard],
  exports: [ApiKeyService, ApiKeyGuard, RateLimitModule],
})
export class ApiKeysModule {}
