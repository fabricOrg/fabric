import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ApiKeyGuard, type RequestTenant } from "../api-keys/api-key.guard.js";
import { invalidRequest, newRequestId } from "../http/api-error.js";
import { SmsService } from "./sms.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

interface SendBody {
  to?: unknown;
  sender_id?: unknown;
  body?: unknown;
  currency?: unknown;
}

function requireString(v: unknown, param: string): string {
  if (typeof v !== "string" || v.length === 0) {
    throw invalidRequest(
      "invalid_field",
      `\`${param}\` is required and must be a non-empty string.`,
      param,
    );
  }
  return v;
}

/**
 * POST /v1/sms/send — the public send endpoint (F5.2). ApiKeyGuard authenticates the key and attaches
 * req.tenant; the handler runs the L5 pipeline under that tenant. Segmentation/rating/reserve/commit
 * all happen in the engine. Success → 201 { id, status, request_id }; bad field → 400 invalid_request_error.
 */
@Controller("v1/sms")
@UseGuards(ApiKeyGuard)
export class SmsController {
  constructor(@Inject(SmsService) private readonly sms: SmsService) {}

  @Post("send")
  async send(
    @Req() req: AuthedRequest,
    @Body() body: SendBody,
  ): Promise<{ id: string; status: string; request_id: string }> {
    const tenant = req.tenant;
    if (!tenant) {
      // Guard guarantees this; defensive.
      throw invalidRequest("no_tenant", "request is not authenticated");
    }
    const result = await this.sms.send({
      tenantId: tenant.id,
      to: requireString(body.to, "to"),
      senderId: requireString(body.sender_id, "sender_id"),
      body: requireString(body.body, "body"),
      currency: requireString(body.currency, "currency"),
    });
    return {
      id: result.messageId,
      status: result.status,
      request_id: newRequestId(),
    };
  }
}
