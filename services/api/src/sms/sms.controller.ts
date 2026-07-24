import type {
  MessageDetailResponse,
  MessageListResponse,
  MessagingInsightsResponse,
  SendSmsApiResponse,
} from "@app/contracts";
import { sendSmsRequest } from "@app/contracts";
import {
  Body,
  Controller,
  Get,
  Headers,
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
import {
  asInsufficientFunds,
  invalidRequest,
  newRequestId,
} from "../http/api-error.js";
import { parsePageQuery } from "../http/cursor.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { MessagingInsightsService } from "./messaging-insights.service.js";
import { SmsService } from "./sms.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
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
    @Inject(MessagingInsightsService)
    private readonly insights: MessagingInsightsService,
  ) {}

  @Post("sms/messages")
  async send(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SendSmsApiResponse> {
    const tenant = requireScope(req.tenant, "sms:send");
    // E10-S5: promotional MUST be declared to receive its stricter DND/quiet-hours treatment;
    // anything else (or absence) is transactional — the platform's wedge traffic.
    const parsed = sendSmsRequest.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_sms",
        parsed.error.issues[0]?.message ?? "Invalid SMS request.",
        parsed.error.issues[0]?.path.join(".") || undefined,
      );
    }
    const input = {
      tenantId: tenant.id,
      to: parsed.data.to,
      senderId: parsed.data.sender_id,
      body: parsed.data.body,
      currency: parsed.data.currency,
      messageClass: parsed.data.class,
      // ADR-0004: route on the presenting key's environment (a sandbox key can never reach a
      // carrier). Null on the BFF token path, which falls back to the tenant/plan-based mode.
      environmentId: tenant.environmentId,
      applicationId: tenant.applicationId,
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
      class: input.messageClass,
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

  /** Compatibility alias for beta clients. New SDK releases use POST /v1/sms/messages. */
  @Post("sms/send")
  async legacySend(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SendSmsApiResponse> {
    return this.send(req, body, idempotencyKey);
  }

  private async execute(input: {
    tenantId: string;
    to: string;
    senderId: string;
    body: string;
    currency: string;
    messageClass: "transactional" | "promotional";
    environmentId?: string | null;
    applicationId?: string | null;
  }): Promise<SendSmsApiResponse> {
    // Mapped at the HTTP boundary, not inside SmsService: the service keeps throwing the wallet
    // DOMAIN error so ManagedMessagesService can still branch on it. Both single-send routes
    // (`sms/messages` and the `sms/send` alias) funnel through here; batches are a separate
    // controller and map it there.
    const result = await this.sms
      .send(input)
      .catch((error: unknown) =>
        asInsufficientFunds(
          error,
          "The wallet balance can't cover this message.",
        ),
      );
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
  async list(
    @Req() req: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ): Promise<MessageListResponse> {
    const tenant = requireScope(req.tenant, "sms:read");
    const page = parsePageQuery(query);
    return {
      ...(await this.sms.list(tenant.id, tenant.environmentId, page)),
      request_id: newRequestId(),
    };
  }

  // Declared before `sms/:id` isn't needed (distinct prefix), but kept beside the log it summarizes.
  @Get("messages/insights")
  async messagingInsights(
    @Req() req: AuthedRequest,
  ): Promise<MessagingInsightsResponse> {
    const tenant = requireScope(req.tenant, "sms:read");
    return {
      summary: await this.insights.summary(tenant.id, tenant.environmentId),
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
      message: await this.sms.get(tenant.id, id, tenant.environmentId),
      request_id: newRequestId(),
    };
  }
}
