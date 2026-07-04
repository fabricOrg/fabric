import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { newRequestId } from "../http/api-error.js";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireTenant,
} from "./api-key.guard.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/context")
@UseGuards(ApiKeyGuard)
export class ApiContextController {
  @Get()
  get(@Req() req: AuthedRequest) {
    const tenant = requireTenant(req.tenant);
    return {
      tenant_id: tenant.id,
      scopes: tenant.scopes,
      request_id: newRequestId(),
    };
  }
}
