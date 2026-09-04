import { type SmsBatchResponse, sendSmsBatchRequest } from "@app/contracts";
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
import { invalidRequest } from "../http/api-error.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { SmsBatchService } from "./sms-batch.service.js";

interface AuthedRequest {
  tenant?: RequestTenant;
}

@Controller("v1/sms/batches")
@UseGuards(ApiKeyGuard)
export class SmsBatchController {
  constructor(
    @Inject(SmsBatchService) private readonly batches: SmsBatchService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Post()
  async create(
    @Req() request: AuthedRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<SmsBatchResponse> {
    const context = requireBatchContext(
      requireScope(request.tenant, "sms:send"),
    );
    if (!idempotencyKey) {
      throw invalidRequest(
        "idempotency_key_required",
        "SMS batches require an Idempotency-Key header.",
      );
    }
    const parsed = sendSmsBatchRequest.safeParse(body);
    if (!parsed.success) {
      throw invalidRequest(
        "invalid_batch",
        parsed.error.issues[0]?.message ?? "Invalid SMS batch.",
        parsed.error.issues[0]?.path.join(".") || undefined,
      );
    }
    const requestHash = this.idempotency.fingerprint(
      {
        channel: "sms",
        operation: "batch",
        ...parsed.data,
      },
      {
        route: "POST /v1/sms/batches",
        environmentId: context.environmentId,
      },
    );
    // Funds failures are handled PER ITEM inside the batch service (an underfunded item is marked
    // failed and the batch still returns 200 with partial success) — a batch must not 402 as a
    // whole and fail its funded items too. So there is deliberately no insufficient-funds mapping
    // here, unlike the single-send path.
    return this.batches.create(
      context,
      idempotencyKey,
      requestHash,
      parsed.data,
    );
  }

  @Get(":id")
  async get(
    @Req() request: AuthedRequest,
    @Param("id") id: string,
  ): Promise<SmsBatchResponse> {
    const context = requireBatchContext(
      requireScope(request.tenant, "sms:read"),
    );
    return this.batches.get(context.tenantId, context.environmentId, id);
  }
}

function requireBatchContext(tenant: RequestTenant): {
  tenantId: string;
  applicationId: string;
  environmentId: string;
} {
  if (!tenant.applicationId || !tenant.environmentId) {
    throw invalidRequest(
      "application_context_required",
      "SMS batches require an application-scoped API key.",
    );
  }
  return {
    tenantId: tenant.id,
    applicationId: tenant.applicationId,
    environmentId: tenant.environmentId,
  };
}
