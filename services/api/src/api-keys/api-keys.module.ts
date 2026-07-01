import { Module } from "@nestjs/common";
import { ApiKeyGuard } from "./api-key.guard.js";
import { ApiKeysController } from "./api-keys.controller.js";
import { ApiKeyService } from "./api-keys.service.js";

/**
 * API-keys feature module (F2.3, L2). Provides + exports the resolver/issuer service and the guard.
 * DbModule is @Global, so ApiKeyService injects APP_DB without a re-import. Protected controllers
 * import this module and apply ApiKeyGuard; the key-management controller (create/list/revoke) is
 * session/operator-gated separately (F2.1 lands later).
 */
@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeyService, ApiKeyGuard],
  exports: [ApiKeyService, ApiKeyGuard],
})
export class ApiKeysModule {}
