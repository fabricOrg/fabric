import type {
  RetrieveManagedMessageResponse,
  SendManagedMessageResponse,
} from "@app/contracts";
import { sendManagedMessageRequest } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
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
import { ManagedMessagesService } from "./managed-messages.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/message-deliveries")
@UseGuards(ApiKeyGuard)
export class ManagedMessagesController {
  constructor(
    @Inject(ManagedMessagesService)
    private readonly messages: ManagedMessagesService,
  ) {}

  @Post()
  @HttpCode(202)
  async send(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SendManagedMessageResponse> {
    const tenant = scopedTenant(request, "messages:send");
    if (!idempotencyKey) {
      throw invalidRequest(
        "idempotency_key_required",
        "Managed sends require an Idempotency-Key header.",
        "Idempotency-Key",
      );
    }
    const parsed = sendManagedMessageRequest.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw invalidRequest(
        "invalid_managed_message",
        issue?.message ?? "Invalid managed message request.",
        issue?.path.map(String).join(".") || undefined,
      );
    }
    return {
      delivery: await this.messages.send({
        tenantId: tenant.id,
        applicationId: tenant.applicationId,
        environmentId: tenant.environmentId,
        idempotencyKey,
        request: parsed.data,
      }),
      request_id: newRequestId(),
    };
  }

  @Get(":id")
  async retrieve(
    @Req() request: AuthedRequest,
    @Param("id") deliveryId: string,
  ): Promise<RetrieveManagedMessageResponse> {
    const tenant = scopedTenant(request, "messages:read");
    return {
      delivery: await this.messages.retrieve({
        tenantId: tenant.id,
        applicationId: tenant.applicationId,
        environmentId: tenant.environmentId,
        deliveryId,
      }),
      request_id: newRequestId(),
    };
  }
}

function scopedTenant(
  request: AuthedRequest,
  scope: "messages:send" | "messages:read",
): RequestTenant & { applicationId: string; environmentId: string } {
  const tenant = requireScope(request.tenant, scope);
  if (!tenant.applicationId || !tenant.environmentId) {
    throw invalidRequest(
      "scoped_api_key_required",
      "Use an application-environment API key for managed messages.",
    );
  }
  return {
    ...tenant,
    applicationId: tenant.applicationId,
    environmentId: tenant.environmentId,
  };
}
