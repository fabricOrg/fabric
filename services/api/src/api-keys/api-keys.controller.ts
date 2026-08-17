import {
  type CreateApiKeyResult,
  createApiKeyRequest,
  type ListApiKeysResponse,
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
import { invalidRequest, newRequestId, notFound } from "../http/api-error.js";
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
    // Parsed against the shared contract, not cast. This route mints a credential; an unchecked
    // `as Record<string, unknown>` at that boundary is the one place it must not happen.
    const parsed = createApiKeyRequest.safeParse(body ?? {});
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw invalidRequest(
        "invalid_api_key_request",
        issue?.message ?? "Invalid API key request.",
        // Numeric segments are dropped so a bad array ELEMENT reports the field a caller can act on
        // — `scopes`, not `scopes.0`. F8.3's `param` names a request field, not a JSON pointer.
        issue?.path
          .filter((segment) => typeof segment !== "number")
          .join(".") || undefined,
      );
    }
    const {
      name,
      env,
      scopes,
      application_id,
      expires_in_days,
      tenantId: suppliedTenantId,
    } = parsed.data;
    const tenantId = resolveTenantId(req, suppliedTenantId);
    const created = await this.svc.create(tenantId, {
      env: env === "sandbox" ? "test" : "live",
      scopes,
      name,
      ...(application_id !== undefined
        ? { applicationId: application_id }
        : {}),
      ...(expires_in_days !== undefined
        ? { expiresInDays: expires_in_days }
        : {}),
    });
    // The ONLY time the full secret crosses the wire. The listed record keeps only the prefix; the
    // authoritative created_at/last_used_at come from the DB on the next list (client re-fetches).
    return {
      key: {
        id: created.id,
        name,
        env: publicEnv(created.env),
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
  async list(
    @Req() req: AuthedRequest,
    @Query("tenantId") tenantId: unknown,
    @Query("applicationId") applicationId: unknown,
  ): Promise<ListApiKeysResponse> {
    const keys = await this.svc.list(
      resolveTenantId(req, tenantId),
      typeof applicationId === "string"
        ? requireUuid(applicationId, "applicationId")
        : undefined,
    );
    // Envelope, not a bare array: every sibling list carries `request_id` so a support ticket can
    // quote one. Breaking, pre-prod, §11.
    return {
      keys: keys.map((key) => ({ ...key, env: publicEnv(key.env) })),
      request_id: newRequestId(),
    };
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

function publicEnv(value: ApiKeyEnv): "sandbox" | "live" {
  return value === "test" ? "sandbox" : "live";
}
