import type { ListRequestLogsResponse } from "@app/contracts";
import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { pageOpts } from "../http/pagination.js";
import { RequestLogService } from "./request-log.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * GET /v1/logs — the developer's request-log view. Tenant-token/`sk_*` gated (ApiKeyGuard); reads the
 * caller's own logs (RLS), scoped to an application + environment, keyset-paginated. Read-only.
 */
@Controller("v1/logs")
@UseGuards(ApiKeyGuard)
export class RequestLogsController {
  constructor(
    @Inject(RequestLogService) private readonly logs: RequestLogService,
  ) {}

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query("applicationId") applicationId: unknown,
    @Query("env") env: unknown,
    @Query("limit") limit: unknown,
    @Query("cursor") cursor: unknown,
  ): Promise<ListRequestLogsResponse> {
    const tenant = requireScope(req.tenant, "request_logs:read");
    return this.logs.list(tenant.id, {
      ...(typeof applicationId === "string" ? { applicationId } : {}),
      ...(env === "sandbox" || env === "live" ? { envType: env } : {}),
      ...pageOpts(
        typeof limit === "string" ? limit : undefined,
        typeof cursor === "string" ? cursor : undefined,
      ),
    });
  }
}
