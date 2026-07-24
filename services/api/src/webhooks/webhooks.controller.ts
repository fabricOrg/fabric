import {
  type CreateWebhookEndpointResponse,
  createWebhookEndpointRequestSchema,
  type ListWebhookDeliveriesResponse,
  type ListWebhookEndpointsResponse,
  type ReplayWebhookDeliveryResponse,
  webhookDeliveryStateSchema,
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
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiKeyGuard,
  type RequestTenant,
  requireScope,
} from "../api-keys/api-key.guard.js";
import { invalidRequest, newRequestId } from "../http/api-error.js";
import { parsePageQuery } from "../http/cursor.js";
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
    const b = (body ?? {}) as Record<string, unknown>;
    const parsed = createWebhookEndpointRequestSchema.safeParse(b);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_webhook",
        "Provide a valid http(s) `url` (and optional `description` ≤ 200 chars).",
        "url",
      );
    }
    // ADR-0004: an endpoint is registered into an application-environment (from the app-detail page).
    const created = await this.webhooks.create(tenant.id, parsed.data, {
      ...(typeof b.application_id === "string"
        ? { applicationId: b.application_id }
        : {}),
      ...(b.env === "live" || b.env === "sandbox" ? { envType: b.env } : {}),
      // An sk_* key already resolves to its application-environment — bind the webhook there instead
      // of guessing the workspace's "default" app (which 500'd for any renamed application).
      ...(tenant.environmentId ? { environmentId: tenant.environmentId } : {}),
    });
    return { ...created, request_id: newRequestId() };
  }

  @Get()
  async list(
    @Req() req: AuthedRequest,
    @Query("applicationId") applicationId: unknown,
  ): Promise<ListWebhookEndpointsResponse> {
    const tenant = requireScope(req.tenant, "api_keys:read");
    return {
      endpoints: await this.webhooks.list(
        tenant.id,
        typeof applicationId === "string" ? applicationId : undefined,
      ),
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
    await this.webhooks.disable(tenant.id, id);
  }

  @Get(":id/deliveries")
  async deliveries(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Query("state") state: unknown,
    @Query() query: Record<string, unknown>,
  ): Promise<ListWebhookDeliveriesResponse> {
    const tenant = requireScope(req.tenant, "api_keys:read");
    const parsedState = webhookDeliveryStateSchema.safeParse(state);
    if (state !== undefined && !parsedState.success) {
      throw invalidRequest(
        "invalid_delivery_state",
        "State must be pending, delivering, delivered, or dead.",
        "state",
      );
    }
    const page = parsePageQuery(query);
    return {
      ...(await this.webhooks.listDeliveries(
        tenant.id,
        id,
        parsedState.success ? parsedState.data : undefined,
        page,
      )),
      request_id: newRequestId(),
    };
  }

  @Post(":id/deliveries/:deliveryId/replay")
  async replay(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("deliveryId") deliveryId: string,
  ): Promise<ReplayWebhookDeliveryResponse> {
    const tenant = requireScope(req.tenant, "api_keys:write");
    return {
      delivery: await this.webhooks.replay(
        tenant.id,
        id,
        deliveryId,
        tenant.keyId,
      ),
      request_id: newRequestId(),
    };
  }
}
