import {
  type EmailMessageListResponse,
  type EmailMessageResponse,
  type SendEmailApiResponse,
  sendEmailApiResponse,
  sendEmailRequest,
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
import { invalidRequest, newRequestId } from "../http/api-error.js";
import { parsePageQuery } from "../http/cursor.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { replayOrConflict } from "../idempotency/replay-parse.js";
import { EmailService } from "./email.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/email/messages")
@UseGuards(ApiKeyGuard)
export class EmailController {
  constructor(
    @Inject(EmailService) private readonly email: EmailService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  async send(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SendEmailApiResponse> {
    const tenant = requireEmailContext(
      requireScope(request.tenant, "email:send"),
    );
    const parsed = sendEmailRequest.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_email",
        parsed.error.issues[0]?.message ?? "Invalid Email request.",
        parsed.error.issues[0]?.path.join(".") || undefined,
      );
    }
    const execute = () => this.email.send(tenant, parsed.data);
    if (idempotencyKey === undefined) return execute();

    const fingerprint = this.idempotency.fingerprint(
      {
        channel: "email",
        ...parsed.data,
      },
      {
        route: "POST /v1/email/messages",
        environmentId: tenant.environmentId,
      },
    );
    const claim = await this.idempotency.begin(
      tenant.tenantId,
      idempotencyKey,
      fingerprint,
    );
    if (claim.kind === "replay") {
      // Parsed, not cast: the stored payload crossed a persistence boundary (a jsonb row an earlier
      // release, or a hand edit, may have written in a different shape).
      return replayOrConflict(sendEmailApiResponse, claim.response);
    }
    let response: SendEmailApiResponse;
    try {
      response = await execute();
    } catch (error) {
      await this.idempotency.release(tenant.tenantId, idempotencyKey);
      throw error;
    }
    await this.idempotency.completeOrLog(
      tenant.tenantId,
      idempotencyKey,
      response,
    );
    return response;
  }

  @Get()
  async list(
    @Req() request: AuthedRequest,
    @Query() query: Record<string, unknown>,
  ): Promise<EmailMessageListResponse> {
    const tenant = requireEmailContext(
      requireScope(request.tenant, "email:read"),
    );
    const page = parsePageQuery(query);
    return {
      ...(await this.email.list(tenant.tenantId, tenant.environmentId, page)),
      request_id: newRequestId(),
    };
  }

  @Get(":id")
  async get(
    @Req() request: AuthedRequest,
    @Param("id") id: string,
  ): Promise<EmailMessageResponse> {
    const tenant = requireEmailContext(
      requireScope(request.tenant, "email:read"),
    );
    return {
      message: await this.email.get(tenant.tenantId, tenant.environmentId, id),
      request_id: newRequestId(),
    };
  }
}

function requireEmailContext(tenant: RequestTenant): {
  tenantId: string;
  applicationId: string;
  environmentId: string;
} {
  if (!tenant.applicationId || !tenant.environmentId) {
    throw invalidRequest(
      "application_context_required",
      "Email requires an application-scoped API key.",
    );
  }
  return {
    tenantId: tenant.id,
    applicationId: tenant.applicationId,
    environmentId: tenant.environmentId,
  };
}
