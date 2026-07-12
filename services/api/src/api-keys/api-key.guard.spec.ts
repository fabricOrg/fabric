import type { ApiErrorEnvelope } from "@app/contracts";
import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import type { RateLimitService } from "../rate-limit/rate-limit.service.js";
import { ApiKeyGuard, extractBearer, requireScope } from "./api-key.guard.js";
import type { ApiKeyService, ResolvedApiKey } from "./api-keys.service.js";
import { TenantTokenService } from "./tenant-token.service.js";

// Minimal fake ExecutionContext wrapping a request with the given headers.
function ctxFor(headers: Record<string, string | undefined>): {
  ctx: ExecutionContext;
  req: { headers: Record<string, string | undefined>; tenant?: unknown };
} {
  const req = { headers } as {
    headers: Record<string, string | undefined>;
    tenant?: unknown;
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

/** Real TenantTokenService with a fixed test secret — token behavior is deterministic. */
function tenantTokens(secret = "guard-spec-secret"): TenantTokenService {
  const config = {
    get: (key: string) => (key === "TENANT_TOKEN_SECRET" ? secret : undefined),
  } as ConfigService;
  return new TenantTokenService(config);
}

/** Stub ApiKeyService with a canned resolve result. */
function guardWithResolve(
  resolve: (raw: string) => Promise<ResolvedApiKey | null>,
): ApiKeyGuard {
  // Rate limit stub: consume() never throws — limiting behavior has its own spec.
  const rateLimit = {
    consume: async () => undefined,
  } as unknown as RateLimitService;
  return new ApiKeyGuard(
    { resolve } as unknown as ApiKeyService,
    rateLimit,
    tenantTokens(),
  );
}

describe("extractBearer", () => {
  it("pulls the token from a well-formed header", () => {
    expect(extractBearer("Bearer sk_test_abc")).toBe("sk_test_abc");
    expect(extractBearer("Bearer   sk_test_xyz")).toBe("sk_test_xyz");
  });
  it("returns null for missing/malformed headers", () => {
    expect(extractBearer(undefined)).toBeNull();
    expect(extractBearer("")).toBeNull();
    expect(extractBearer("sk_test_abc")).toBeNull(); // no scheme
    expect(extractBearer("Basic abc")).toBeNull();
    expect(extractBearer("Bearer ")).toBeNull();
  });
  it("takes the first value if the header is an array", () => {
    expect(extractBearer(["Bearer sk_test_a", "Bearer sk_test_b"])).toBe(
      "sk_test_a",
    );
  });
});

describe("ApiKeyGuard (F2.3)", () => {
  it("attaches req.tenant and allows a valid key", async () => {
    const guard = guardWithResolve(async () => ({
      tenantId: "00000000-0000-0000-0000-0000000000a1",
      scopes: ["sms:send"],
      keyId: "abcdef0123456789",
      applicationId: null,
      environmentId: null,
    }));
    const { ctx, req } = ctxFor({ authorization: "Bearer sk_test_valid" });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenant).toEqual({
      id: "00000000-0000-0000-0000-0000000000a1",
      scopes: ["sms:send"],
      keyId: "abcdef0123456789",
      applicationId: null,
      environmentId: null,
    });
  });

  it("401s (F8.3 auth_error) on an unknown/revoked key", async () => {
    const guard = guardWithResolve(async () => null);
    const { ctx } = ctxFor({ authorization: "Bearer sk_test_revoked" });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
    try {
      await guard.canActivate(ctx);
    } catch (e) {
      const body = (e as { getResponse(): ApiErrorEnvelope }).getResponse();
      expect(body.error.type).toBe("auth_error");
      expect(body.error.code).toBe("invalid_api_key");
      expect(body.request_id).toMatch(/^req_/);
    }
  });

  it("401s when the Authorization header is missing (no resolve attempted)", async () => {
    let called = false;
    const guard = guardWithResolve(async () => {
      called = true;
      return null;
    });
    const { ctx } = ctxFor({});
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
    expect(called).toBe(false); // rejected before touching the service
  });

  it("accepts a minted bfft_ tenant token with wildcard scopes (ADR-0003)", async () => {
    let keyResolveCalled = false;
    const guard = guardWithResolve(async () => {
      keyResolveCalled = true;
      return null;
    });
    const tenantId = "00000000-0000-0000-0000-0000000000a1";
    const { token } = tenantTokens().mint(tenantId);
    const { ctx, req } = ctxFor({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.tenant).toEqual({
      id: tenantId,
      scopes: ["*"],
      keyId: `bfft_${tenantId.slice(0, 12)}`,
      applicationId: null,
      environmentId: null,
    });
    expect(keyResolveCalled).toBe(false); // token path never hits the key lookup
  });

  it("401s a forged/expired bfft_ token without consulting the key service", async () => {
    let keyResolveCalled = false;
    const guard = guardWithResolve(async () => {
      keyResolveCalled = true;
      return null;
    });
    // Signed under a DIFFERENT secret → signature mismatch for the guard's service.
    const { token } = tenantTokens("other-secret").mint(
      "00000000-0000-0000-0000-0000000000a1",
    );
    const { ctx } = ctxFor({ authorization: `Bearer ${token}` });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 401 });
    try {
      await guard.canActivate(ctx);
    } catch (e) {
      const body = (e as { getResponse(): ApiErrorEnvelope }).getResponse();
      expect(body.error.code).toBe("invalid_tenant_token");
    }
    expect(keyResolveCalled).toBe(false);
  });
});

describe("requireScope", () => {
  const tenant = {
    id: "00000000-0000-0000-0000-0000000000a1",
    scopes: ["sms:read"],
    keyId: "abcdef0123456789",
    applicationId: null,
    environmentId: null,
  };

  it("returns a tenant with the required or wildcard scope", () => {
    expect(requireScope(tenant, "sms:read")).toBe(tenant);
    expect(requireScope({ ...tenant, scopes: ["*"] }, "wallet:read")).toEqual({
      ...tenant,
      scopes: ["*"],
    });
  });

  it("returns a structured 403 when the key lacks permission", () => {
    try {
      requireScope(tenant, "wallet:read");
      expect.unreachable("scope check should fail");
    } catch (error) {
      const exception = error as {
        getStatus(): number;
        getResponse(): ApiErrorEnvelope;
      };
      expect(exception.getStatus()).toBe(403);
      expect(exception.getResponse().error.code).toBe("insufficient_scope");
    }
  });
});
