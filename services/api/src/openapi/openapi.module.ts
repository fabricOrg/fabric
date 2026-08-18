import { Module } from "@nestjs/common";
import { DocsAccessGuard } from "./docs-access.guard.js";
import { OpenApiController } from "./openapi.controller.js";
import { OpenApiService } from "./openapi.service.js";

/**
 * The operator-gated docs surface. Holds no container introspection: the specification is built
 * ahead of time by `scripts/generate-openapi.ts` and served from the committed artifact, so this
 * module adds no boot-time work and no new dependency to the API.
 */
@Module({
  controllers: [OpenApiController],
  providers: [OpenApiService, DocsAccessGuard],
  exports: [OpenApiService],
})
export class OpenApiModule {}
