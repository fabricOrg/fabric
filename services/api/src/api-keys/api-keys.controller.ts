import {
  type ApiKey,
  apiKeyScopes,
  type CreateApiKeyResult,
} from "@app/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { invalidRequest, notFound } from "../http/api-error.js";
import type { ApiKeyEnv } from "./api-key.crypto.js";
import type { RequestTenant } from "./api-key.guard.js";
import { ApiKeyService } from "./api-keys.service.js";
import { OperatorOrTenantGuard } from "./operator-or-tenant.guard.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AuthedRequest {
  tenant?: RequestTenant;
}

/**
 * Key MANAGEMENT endpoints (F2.3). Create / list / revoke.
 *
 * OperatorOrTenantGuard serves two callers on one surface (ADR-0004): the customer dashboard's BFF
 * (a tenant token per ADR-0003 → `req.tenant`) and staff/ops (an operator token + an operator-
 * supplied tenantId). With a session authenticated the tenantId is the token's — a client-supplied
 * tenantId is ignored, never trusted. Deliberately NOT ApiKeyGuard-only: you can't mint the FIRST
 * key with a key. The raw secret is returned exactly once, at creation.
 */
@Controller("v1/api-keys")
@UseGuards(OperatorOrTenantGuard)
export class ApiKeysController {
  constructor(@Inject(ApiKeyService) private readonly svc: ApiKeyService) {}

  @Post()
  async create(
    @Req() req: AuthedRequest,
    @Body() body: unknown,
  ): Promise<CreateApiKeyResult> {
    const b = (body ?? {}) as Record<string, unknown>;
    const tenantId = resolveTenantId(req, b.tenantId);
    const name = typeof b.name === "string" ? b.name : "";
    const expiresInDays = optionalExpiryDays(b.expires_in_days);
    const created = await this.svc.create(tenantId, {
      env: requireEnv(b.env),
      scopes: requireScopes(b.scopes),
      ...(name ? { name } : {}),
      ...(b.application_id !== undefined
        ? { applicationId: requireUuid(b.application_id, "application_id") }
        : {}),
      ...(expiresInDays !== undefined ? { expiresInDays } : {}),
    });
    // The ONLY time the full secret crosses the wire. The listed record keeps only the prefix; the
    // authoritative created_at/last_used_at come from the DB on the next list (client re-fetches).
    return {
      key: {
        id: created.id,
        name,
        env: created.env,
        prefix: created.prefix,
        scopes: created.scopes,
        status: "active",
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        expiresAt: created.expiresAt,
      },
      secret: created.raw,
    };
  }

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query("tenantId") tenantId: unknown,
    @Query("applicationId") applicationId: unknown,
  ): Promise<ApiKey[]> {
    return this.svc.list(
      resolveTenantId(req, tenantId),
      typeof applicationId === "string"
        ? requireUuid(applicationId, "applicationId")
        : undefined,
    );
  }

  @Delete(":id")
  async revoke(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Query("tenantId") tenantId: unknown,
  ): Promise<{ revoked: boolean }> {
    const ok = await this.svc.revoke(
      resolveTenantId(req, tenantId),
      requireUuid(id, "id"),
    );
    if (!ok) {
      throw notFound("api_key_not_found", "No active API key with that id.");
    }
    return { revoked: true };
  }
}

/**
 * Session path → the tenant is the authenticated token's tenant (client input ignored). Operator
 * path (no `req.tenant`) → the operator supplies the tenantId, validated as a uuid.
 */
function resolveTenantId(req: AuthedRequest, supplied: unknown): string {
  if (req.tenant) return req.tenant.id;
  return requireUuid(supplied, "tenantId");
}

function requireUuid(value: unknown, param: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw invalidRequest("invalid_uuid", `${param} must be a uuid.`, param);
  }
  return value;
}

/** Optional key lifetime in days: absent/null → never expires; anything else must be a positive int. */
function optionalExpiryDays(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw invalidRequest(
      "invalid_expiry",
      "expires_in_days must be a positive integer.",
      "expires_in_days",
    );
  }
  return value;
}

function requireEnv(value: unknown): ApiKeyEnv {
  if (value !== "test" && value !== "live") {
    throw invalidRequest("invalid_env", "env must be 'test' or 'live'.", "env");
  }
  return value;
}

function requireScopes(value: unknown): string[] {
  const parsed = apiKeyScopes.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest(
      "invalid_scopes",
      "Choose at least one supported API key scope.",
      "scopes",
    );
  }
  return parsed.data;
}
