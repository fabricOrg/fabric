import type { EmailContentResponse, EmailInboxResponse } from "@app/contracts";
import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest } from "../http/api-error.js";
import { parsePageQuery } from "../http/cursor.js";
import { BffTokenGuard } from "../identity/bff-token.guard.js";
import { EmailInboxService } from "./email-inbox.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dashboard-facing email surface (BFF-token, tenant-scoped) — the workspace can't use the /v1/email
 * routes because those require an application-scoped API key, whereas the dashboard's minted tenant
 * token is workspace-wide. Mirrors the virtual-phone internal controller.
 */
@Controller("internal/tenants")
@UseGuards(BffTokenGuard)
export class EmailInboxController {
  constructor(
    @Inject(EmailInboxService) private readonly email: EmailInboxService,
  ) {}

  @Get(":tenantId/emails")
  async inbox(
    @Param("tenantId") tenantId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<EmailInboxResponse> {
    assertUuid(tenantId);
    return this.email.listForEnvironmentType(
      tenantId,
      environmentType(query.env),
      parsePageQuery(query),
    );
  }

  @Get(":tenantId/emails/:id/content")
  content(
    @Param("tenantId") tenantId: string,
    @Param("id") id: string,
    @Query("env") env?: string,
  ): Promise<EmailContentResponse> {
    assertUuid(tenantId);
    assertUuid(id);
    return this.email.getContent(tenantId, environmentType(env), id);
  }
}

function assertUuid(value: string): void {
  if (!UUID.test(value))
    throw invalidRequest("invalid_id", "Invalid identifier.");
}

function environmentType(value: unknown): "sandbox" | "live" {
  if (value === "sandbox" || value === "live") return value;
  throw invalidRequest("invalid_env", "env must be sandbox or live.", "env");
}
