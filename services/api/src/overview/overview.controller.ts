import type { OverviewResponse } from "@app/contracts";
import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { OverviewService } from "./overview.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/overview")
@UseGuards(ApiKeyGuard)
export class OverviewController {
  constructor(
    @Inject(OverviewService) private readonly overview: OverviewService,
  ) {}

  @Get()
  async get(@Req() req: AuthedRequest): Promise<OverviewResponse> {
    const tenant = requireScope(req.tenant, "sms:read");
    requireScope(req.tenant, "wallet:read");
    return this.overview.get(tenant.id, tenant.environmentId);
  }
}
