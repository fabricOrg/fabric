import type {
  MessageDetailResponse,
  MessageListResponse,
  SendSmsApiResponse,
} from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
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
import { IdempotencyService } from "../idempotency/idempotency.service.js";
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
@Controller("v1")
@UseGuards(ApiKeyGuard)
export class SmsController {
  constructor(
    @Inject(SmsService) private readonly sms: SmsService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post("sms/send")
  async send(
    @Req() req: AuthedRequest,
    @Body() body: SendBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SendSmsApiResponse> {
    const tenant = requireScope(req.tenant, "sms:send");
    const input = {
      tenantId: tenant.id,
      to: requireString(body.to, "to"),
      senderId: requireString(body.sender_id, "sender_id"),
      body: requireString(body.body, "body"),
      currency: requireString(body.currency, "currency"),
    };

    // No header → the un-keyed path (a client that doesn't retry-protect gets today's behavior).
    if (idempotencyKey === undefined) {
      return this.execute(input);
    }

    // Keyed path: claim the key BEFORE the money moves. Same key + same body → replay the stored
    // response (no second charge); reused/in-flight keys 409 inside begin().
    const fingerprint = this.idempotency.fingerprint({
      to: input.to,
      sender_id: input.senderId,
      body: input.body,
      currency: input.currency,
    });
    const claim = await this.idempotency.begin(
      tenant.id,
      idempotencyKey,
      fingerprint,
    );
    if (claim.kind === "replay") {
      return claim.response as SendSmsApiResponse;
    }
    try {
      const response = await this.execute(input);
      await this.idempotency.complete(tenant.id, idempotencyKey, response);
      return response;
    } catch (error) {
      // Failed request releases the key so the client may retry with it.
      await this.idempotency.release(tenant.id, idempotencyKey);
      throw error;
    }
  }

  private async execute(input: {
    tenantId: string;
    to: string;
    senderId: string;
    body: string;
    currency: string;
  }): Promise<SendSmsApiResponse> {
    const result = await this.sms.send(input);
    return {
      id: result.id,
      status: result.status,
      encoding: result.encoding,
      segments: result.segments,
      cost: result.cost,
      request_id: newRequestId(),
    };
  }

  @Get("messages")
  async list(@Req() req: AuthedRequest): Promise<MessageListResponse> {
    const tenant = requireScope(req.tenant, "sms:read");
    return {
      messages: await this.sms.list(tenant.id),
      request_id: newRequestId(),
    };
  }

  @Get("sms/:id")
  async get(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
  ): Promise<MessageDetailResponse> {
    const tenant = requireScope(req.tenant, "sms:read");
    return {
      message: await this.sms.get(tenant.id, id),
      request_id: newRequestId(),
    };
  }
}
