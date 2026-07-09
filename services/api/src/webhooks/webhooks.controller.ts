import {
  type CreateWebhookEndpointResponse,
  createWebhookEndpointRequestSchema,
  type ListWebhookEndpointsResponse,
} from "@app/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest, newRequestId } from "../http/api-error.js";
import { WebhooksService } from "./webhooks.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * /v1/webhooks — tenant webhook endpoint management (finding 8). Gated like the other
 * integration-surface endpoints: api_keys:write (owner + developer roles) — registering a
 * webhook is integration plumbing, not org administration.
 */
@Controller("v1/webhooks")
@UseGuards(ApiKeyGuard)
export class WebhooksController {
  constructor(
    @Inject(WebhooksService) private readonly webhooks: WebhooksService,
  ) {}

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<CreateWebhookEndpointResponse & { request_id: string }> {
    const tenant = requireScope(req.tenant, "api_keys:write");
    const parsed = createWebhookEndpointRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_webhook",
        "Provide a valid http(s) `url` (and optional `description` ≤ 200 chars).",
        "url",
      );
    }
    const created = await this.webhooks.create(tenant.id, parsed.data);
    return { ...created, request_id: newRequestId() };
  }

  @Get()
  async list(@Req() req: AuthedRequest): Promise<ListWebhookEndpointsResponse> {
    const tenant = requireScope(req.tenant, "api_keys:read");
    return {
      endpoints: await this.webhooks.list(tenant.id),
      request_id: newRequestId(),
    };
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
  ): Promise<void> {
    const tenant = requireScope(req.tenant, "api_keys:write");
    await this.webhooks.remove(tenant.id, id);
  }
}
