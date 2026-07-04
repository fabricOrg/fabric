import { Module } from "@nestjs/common";
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
  controllers: [ApiKeysController],
  providers: [ApiKeyService, ApiKeyGuard, OperatorTokenGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeysModule {}
