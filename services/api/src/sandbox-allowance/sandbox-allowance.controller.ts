import type { SandboxAllowancesResponse } from "@app/contracts";
import type { AppDb } from "@app/db";
import { Controller, Get, Inject, Req, UseGuards } from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { APP_DB } from "../db/db.module.js";
import { newRequestId } from "../http/api-error.js";
import { SandboxAllowanceService } from "./sandbox-allowance.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/sandbox-allowances")
@UseGuards(ApiKeyGuard)
export class SandboxAllowanceController {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(SandboxAllowanceService)
    private readonly allowances: SandboxAllowanceService,
  ) {}

  @Get()
  async get(@Req() req: AuthedRequest): Promise<SandboxAllowancesResponse> {
    const tenant = requireScope(req.tenant, "wallet:read");
    return {
      ...(await this.allowances.snapshot(this.db, tenant.id)),
      request_id: newRequestId(),
    };
  }
}
