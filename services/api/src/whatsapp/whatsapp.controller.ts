import {
  type WhatsappMessageListResponse,
  type WhatsappMessageResponse,
  type WhatsappSendResponse,
  whatsappSendRequest,
  whatsappSendResponse,
} from "@app/contracts";
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
import { WhatsappService } from "./whatsapp.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/whatsapp/messages")
@UseGuards(ApiKeyGuard)
export class WhatsappController {
  constructor(
    @Inject(WhatsappService) private readonly whatsapp: WhatsappService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  async send(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<WhatsappSendResponse> {
    const tenant = requireWhatsappContext(
      requireScope(request.tenant, "whatsapp:send"),
    );
    const parsed = whatsappSendRequest.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_whatsapp",
        parsed.error.issues[0]?.message ?? "Invalid WhatsApp request.",
        parsed.error.issues[0]?.path.join(".") || undefined,
      );
    }
    if (!idempotencyKey) {
      throw invalidRequest(
        "idempotency_key_required",
        "WhatsApp sends require an Idempotency-Key header.",
        "Idempotency-Key",
      );
    }
    const execute = () =>
      this.whatsapp
        .send(tenant, parsed.data)
        .catch((error: unknown) =>
          asInsufficientFunds(
            error,
            "The wallet balance can't cover this WhatsApp message.",
          ),
        );
    const fingerprint = this.idempotency.fingerprint({
      channel: "whatsapp",
      ...parsed.data,
    });
    const claim = await this.idempotency.begin(
      tenant.tenantId,
      idempotencyKey,
      fingerprint,
    );
    if (claim.kind === "replay") {
      // Parsed, not cast: the stored payload crossed a persistence boundary (a jsonb row an earlier
      // release, or a hand edit, may have written in a different shape).
      return whatsappSendResponse.parse(claim.response);
    }
    let response: WhatsappSendResponse;
    try {
      response = await execute();
    } catch (error) {
      await this.idempotency.release(tenant.tenantId, idempotencyKey);
      throw error;
    }
    await this.idempotency.complete(tenant.tenantId, idempotencyKey, response);
    return response;
  }

  @Get()
  async list(
    @Req() request: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ): Promise<WhatsappMessageListResponse> {
    const tenant = requireWhatsappContext(
      requireScope(request.tenant, "whatsapp:send"),
    );
    return {
      ...(await this.whatsapp.list(
        tenant.tenantId,
        tenant.environmentId,
        parsePageQuery(query),
      )),
      request_id: newRequestId(),
    };
  }

  @Get(":id")
  async get(
    @Req() request: AuthedRequest,
    @Param("id") id: string,
  ): Promise<WhatsappMessageResponse> {
    const tenant = requireWhatsappContext(
      requireScope(request.tenant, "whatsapp:send"),
    );
    return {
      message: await this.whatsapp.get(
        tenant.tenantId,
        tenant.environmentId,
        id,
      ),
      request_id: newRequestId(),
    };
  }
}

function requireWhatsappContext(tenant: RequestTenant): {
  tenantId: string;
  applicationId: string;
  environmentId: string;
} {
  if (!tenant.applicationId || !tenant.environmentId) {
    throw invalidRequest(
      "application_context_required",
      "WhatsApp requires an application-scoped API key.",
    );
  }
  return {
    tenantId: tenant.id,
    applicationId: tenant.applicationId,
    environmentId: tenant.environmentId,
  };
}
