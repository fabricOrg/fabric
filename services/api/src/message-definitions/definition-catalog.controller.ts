import type { DefinitionCatalogManifest } from "@app/contracts";
import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { forbidden } from "../http/api-error.js";
import { DefinitionCatalogService } from "./definition-catalog.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/definitions")
@UseGuards(ApiKeyGuard)
export class DefinitionCatalogController {
  constructor(
    @Inject(DefinitionCatalogService)
    private readonly catalog: DefinitionCatalogService,
  ) {}

  @Get("catalog")
  read(@Req() request: AuthedRequest): Promise<DefinitionCatalogManifest> {
    const tenant = requireScope(request.tenant, "definitions:read");
    if (!tenant.applicationId || !tenant.environmentId) {
      throw forbidden(
        "scoped_api_key_required",
        "Use an application-environment API key to read a definition catalog.",
      );
    }
    return this.catalog.read({
      tenantId: tenant.id,
      applicationId: tenant.applicationId,
      environmentId: tenant.environmentId,
    });
  }
}
