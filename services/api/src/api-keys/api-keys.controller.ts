import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { invalidRequest, notFound } from "../http/api-error.js";
import type { ApiKeyEnv } from "./api-key.crypto.js";
import {
  ApiKeyService,
  type ApiKeySummary,
  type CreatedApiKey,
} from "./api-keys.service.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Key MANAGEMENT endpoints (F2.3, L2 increment 4). Create / list / revoke.
 *
 * OPERATOR/SEED-gated for the Walking-Skeleton demo: there's no customer session yet (F2.1), so
 * `tenantId` is supplied by the operator (body on create, query on list/revoke). When F2.1 lands the
 * tenant comes from the session and the operator-supplied tenantId drops. Deliberately NOT behind
 * ApiKeyGuard — that guards data-plane routes (POST /v1/sms/send …); you can't mint the FIRST key
 * with a key. All input is validated → F8.3 invalid_request_error with `param`.
 */
@Controller("v1/api-keys")
export class ApiKeysController {
  constructor(@Inject(ApiKeyService) private readonly svc: ApiKeyService) {}

  @Post()
  create(@Body() body: unknown): Promise<CreatedApiKey> {
    const b = (body ?? {}) as Record<string, unknown>;
    return this.svc.create(requireUuid(b.tenantId, "tenantId"), {
      env: requireEnv(b.env),
      scopes: requireScopes(b.scopes),
      ...(typeof b.name === "string" ? { name: b.name } : {}),
    });
  }

  @Get()
  list(@Query("tenantId") tenantId: unknown): Promise<ApiKeySummary[]> {
    return this.svc.list(requireUuid(tenantId, "tenantId"));
  }

  @Delete(":id")
  async revoke(
    @Param("id") id: string,
    @Query("tenantId") tenantId: unknown,
  ): Promise<{ revoked: boolean }> {
    const ok = await this.svc.revoke(
      requireUuid(tenantId, "tenantId"),
      requireUuid(id, "id"),
    );
    if (!ok) {
      throw notFound("api_key_not_found", "No active API key with that id.");
    }
    return { revoked: true };
  }
}

function requireUuid(value: unknown, param: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw invalidRequest("invalid_uuid", `${param} must be a uuid.`, param);
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
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((s) => typeof s !== "string")) {
    throw invalidRequest(
      "invalid_scopes",
      "scopes must be an array of strings.",
      "scopes",
    );
  }
  return value as string[];
}
