import {
  type WhatsappMessageListResponse,
  type WhatsappSendResponse,
  type WhatsappTemplateListResponse,
  whatsappSendRequest,
  whatsappSendResponse,
} from "@app/contracts";
import type { AppDb } from "@app/db";
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { APP_DB } from "../db/db.module.js";
import {
  asInsufficientFunds,
  invalidRequest,
  newRequestId,
  notFound,
} from "../http/api-error.js";
import { parseUuidPageQuery } from "../http/cursor.js";
import { parseMessageStatusGroup } from "../http/message-status-filter.js";
import { IdempotencyService } from "../idempotency/idempotency.service.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { WhatsappService } from "./whatsapp.service.js";
import { listApprovedTemplates } from "./whatsapp-template-reads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EnvironmentType = "sandbox" | "live";
type Row = Record<string, unknown>;

/**
 * Dashboard-facing WhatsApp surface (BFF-token, tenant-scoped). The dashboard can't use
 * /v1/whatsapp/messages because those routes require application-scoped API-key context; this
 * endpoint resolves the workspace application/environment before reusing WhatsappService.send.
 */
@Controller("internal/tenants")
@UseGuards(BffTokenGuard)
export class WhatsappInboxController {
  constructor(
    @Inject(APP_DB) private readonly db: AppDb,
    @Inject(WhatsappService) private readonly whatsapp: WhatsappService,
    @Inject(IdempotencyService)
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get(":tenantId/whatsapp")
  async inbox(
    @Param("tenantId") tenantId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<WhatsappMessageListResponse> {
    const normalizedTenantId = parseUuid(tenantId);
    const environment = await this.resolveEnvironment(
      normalizedTenantId,
      environmentType(query.env),
    );
    return {
      ...(await this.whatsapp.list(
        normalizedTenantId,
        environment.environmentId,
        parseUuidPageQuery(query),
        parseMessageStatusGroup(query.status),
      )),
      request_id: newRequestId(),
    };
  }

  /**
   * The APPROVED template catalog for the picker. Read-only, and it exists so a sender never types a
   * template name from memory — a name Meta does not have fails at the provider AFTER the reserve.
   */
  @Get(":tenantId/whatsapp/templates")
  async templates(
    @Param("tenantId") tenantId: string,
  ): Promise<WhatsappTemplateListResponse> {
    const normalizedTenantId = parseUuid(tenantId);
    const { templates, syncedAt } = await listApprovedTemplates(
      this.db,
      normalizedTenantId,
    );
    return {
      templates,
      // Surfaced rather than hidden: the catalog is a cache of Meta's state (ADR-0014 §4), so a
      // stale list is a real condition the UI should be able to say out loud.
      synced_at: syncedAt ? syncedAt.toISOString() : null,
      request_id: newRequestId(),
    };
  }

  @Post(":tenantId/whatsapp")
  async send(
    @Param("tenantId") tenantId: string,
    @Query("env") env: string | undefined,
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<WhatsappSendResponse> {
    const normalizedTenantId = parseUuid(tenantId);
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
    const environment = await this.resolveEnvironment(
      normalizedTenantId,
      environmentType(env),
    );
    const fingerprint = this.idempotency.fingerprint({
      channel: "whatsapp",
      ...parsed.data,
    });
    const claim = await this.idempotency.begin(
      normalizedTenantId,
      idempotencyKey,
      fingerprint,
    );
    if (claim.kind === "replay") {
      return whatsappSendResponse.parse(claim.response);
    }
    let response: WhatsappSendResponse;
    try {
      response = await this.whatsapp
        .send(
          {
            tenantId: normalizedTenantId,
            applicationId: environment.applicationId,
            environmentId: environment.environmentId,
          },
          parsed.data,
        )
        .catch((error: unknown) =>
          asInsufficientFunds(
            error,
            "The wallet balance can't cover this WhatsApp message.",
          ),
        );
    } catch (error) {
      await this.idempotency.release(normalizedTenantId, idempotencyKey);
      throw error;
    }
    await this.idempotency.completeOrLog(
      normalizedTenantId,
      idempotencyKey,
      response,
    );
    return response;
  }

  private async resolveEnvironment(
    tenantId: string,
    env: EnvironmentType,
  ): Promise<{ applicationId: string; environmentId: string }> {
    const rows = (await this.db.withTenant(
      tenantId,
      (tx) => tx`
        SELECT a.id AS application_id, e.id AS environment_id
        FROM applications a
        JOIN environments e
          ON e.application_id = a.id AND e.tenant_id = a.tenant_id
        WHERE a.tenant_id = ${tenantId}
          AND e.type = ${env}
          AND e.status = 'active'
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT 1`,
    )) as Row[];
    const row = rows[0];
    if (!row) {
      throw notFound(
        "whatsapp_environment_not_found",
        "No active WhatsApp environment was found for this workspace.",
      );
    }
    return {
      applicationId: String(row.application_id),
      environmentId: String(row.environment_id),
    };
  }
}

function parseUuid(value: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) {
    throw invalidRequest("invalid_id", "Invalid identifier.");
  }
  return normalized;
}

function environmentType(value: unknown): EnvironmentType {
  if (value === "sandbox" || value === "live") return value;
  throw invalidRequest("invalid_env", "env must be sandbox or live.", "env");
}
