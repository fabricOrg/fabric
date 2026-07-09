import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { forbidden, unauthorized } from "../http/api-error.js";
import { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { ApiKeyService } from "./api-keys.service.js";

/** The tenant context a resolved key attaches to the request; handlers run data access via it. */
export interface RequestTenant {
  readonly id: string;
  readonly scopes: string[];
  /** Rate-limit bucket id for the presenting key (hash prefix — never raw key material). */
  readonly keyId: string;
}

/** Minimal shape we read/attach — avoids coupling to a specific HTTP adapter's request type. */
interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  tenant?: RequestTenant;
}

/**
 * ApiKeyGuard (F2.3, L2) — authenticates a public-API request by its `Authorization: Bearer sk_…`
 * key: resolve → tenant, attach `req.tenant` (handlers then run through `withTenant(req.tenant.id)`).
 * Unknown / revoked / malformed → 401 in the F8.3 `auth_error` envelope. Apply to protected
 * controllers (e.g. the SMS/wallet routes); NOT to the key-management endpoints (those are
 * session/operator-gated). The cross-tenant resolve is confined to the possession-scoped RLS lookup.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  // Explicit @Inject(token) — NOT type-reflection DI — so injection works under the tsx dev runner
  // too (esbuild doesn't emit decorator metadata; matches DbModule's @Inject(APP_DB) discipline).
  constructor(
    @Inject(ApiKeyService) private readonly apiKeys: ApiKeyService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const raw = extractBearer(req.headers.authorization);
    if (raw === null) {
      throw unauthorized(
        "missing_api_key",
        "Missing or malformed Authorization header. Use: Authorization: Bearer sk_test_…",
      );
    }
    const resolved = await this.apiKeys.resolve(raw);
    if (resolved === null) {
      throw unauthorized("invalid_api_key", "Invalid or revoked API key.");
    }
    // Rate limit AFTER auth (unauthenticated traffic never reaches the counters, so garbage keys
    // can't exhaust a tenant's budget) — throws 429 when the key's or tenant's bucket is empty.
    await this.rateLimit.consume(resolved.keyId, resolved.tenantId);
    req.tenant = {
      id: resolved.tenantId,
      scopes: resolved.scopes,
      keyId: resolved.keyId,
    };
    return true;
  }
}

/** Pull the bearer token out of an Authorization header value; null if absent/malformed. */
export function extractBearer(
  header: string | string[] | undefined,
): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const match = /^Bearer[ ]+(\S+)$/.exec(value.trim());
  return match?.[1] ?? null;
}

/** Enforce a resolved key's permission at the controller boundary. */
export function requireScope(
  tenant: RequestTenant | undefined,
  scope: string,
): RequestTenant {
  const resolved = requireTenant(tenant);
  if (!resolved.scopes.includes(scope) && !resolved.scopes.includes("*")) {
    throw forbidden(
      "insufficient_scope",
      `The API key requires the \`${scope}\` scope for this operation.`,
    );
  }
  return resolved;
}

export function requireTenant(
  tenant: RequestTenant | undefined,
): RequestTenant {
  if (!tenant) {
    throw unauthorized("no_tenant", "Request is not authenticated.");
  }
  return tenant;
}
