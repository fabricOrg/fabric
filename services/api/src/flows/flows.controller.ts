import { confirmFlowRequest, startFlowRequest } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest } from "../http/api-error.js";
import { FlowsService } from "./flows.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/** Tenant-facing Transactions explorer (dashboard BFF → api key). GET the feed; POST runs the
 *  verify→charge→notify flow (start then confirm). */
@Controller("v1/flows")
@UseGuards(ApiKeyGuard)
export class FlowsController {
  constructor(@Inject(FlowsService) private readonly flows: FlowsService) {}

  @Get()
  async list(@Req() req: AuthedRequest) {
    const tenant = requireScope(req.tenant, "wallet:read");
    return this.flows.list(tenant.id);
  }

  @Post()
  async run(@Req() req: AuthedRequest, @Body() body: unknown) {
    const tenant = requireScope(req.tenant, "wallet:read");
    const action = (body as { action?: unknown }).action;

    if (action === "start") {
      const parsed = startFlowRequest.safeParse(body);
      if (!parsed.success) {
        throw invalidRequest(
          "invalid_flow",
          "Provide msisdn, currency, amount and channel.",
        );
      }
      return this.flows.start(tenant.id, parsed.data);
    }
    if (action === "confirm") {
      const parsed = confirmFlowRequest.safeParse(body);
      if (!parsed.success) {
        throw invalidRequest(
          "invalid_flow",
          "Provide the correlation id and code.",
        );
      }
      return this.flows.confirm(tenant.id, parsed.data);
    }
    throw invalidRequest("invalid_flow", "Unknown flow action.");
  }
}
