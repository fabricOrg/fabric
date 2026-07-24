import {
  type EmailMessageListResponse,
  type EmailMessageResponse,
  type SendEmailApiResponse,
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

    const fingerprint = this.idempotency.fingerprint({
      channel: "email",
      ...parsed.data,
    });
    const claim = await this.idempotency.begin(
      tenant.tenantId,
      idempotencyKey,
      fingerprint,
    );
    if (claim.kind === "replay") {
      return claim.response as SendEmailApiResponse;
    }
    try {
      const response = await execute();
      await this.idempotency.complete(
        tenant.tenantId,
        idempotencyKey,
        response,
      );
      return response;
    } catch (error) {
      await this.idempotency.release(tenant.tenantId, idempotencyKey);
      throw error;
    }
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
