import type { ApiErrorEnvelope } from "@app/contracts";
import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyGuard } from "./api-key.guard.js";
import { OperatorOrTenantGuard } from "./operator-or-tenant.guard.js";

const OPERATOR_TOKEN = "op-secret-token";

function ctxFor(headers: Record<string, string | undefined>): ExecutionContext {
  const req = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

/** The guard returns a boolean OR throws synchronously on the operator path, but a Promise on the
 *  delegated customer path. Defer the call so both sync and async outcomes surface uniformly. */
function activate(
  guard: OperatorOrTenantGuard,
  ctx: ExecutionContext,
): Promise<boolean> {
  return Promise.resolve().then(() => guard.canActivate(ctx));
}

function guardWith(operatorToken: string | undefined = OPERATOR_TOKEN): {
  guard: OperatorOrTenantGuard;
  apiKeyCanActivate: ReturnType<typeof vi.fn>;
} {
  const config = {
    get: (key: string) =>
      key === "OPERATOR_TOKEN" ? operatorToken : undefined,
  } as unknown as ConfigService;
  const apiKeyCanActivate = vi.fn(async () => true);
  const apiKeyGuard = {
    canActivate: apiKeyCanActivate,
  } as unknown as ApiKeyGuard;
  return {
    guard: new OperatorOrTenantGuard(config, apiKeyGuard),
    apiKeyCanActivate,
  };
}

describe("OperatorOrTenantGuard (ADR-0004 mgmt auth)", () => {
  it("allows a valid operator token WITHOUT touching the ApiKeyGuard", async () => {
    const { guard, apiKeyCanActivate } = guardWith();
    const ctx = ctxFor({ "x-operator-token": OPERATOR_TOKEN });
    await expect(activate(guard, ctx)).resolves.toBe(true);
    expect(apiKeyCanActivate).not.toHaveBeenCalled();
  });

  it("401s a present-but-invalid operator token (never falls through to the customer path)", async () => {
    const { guard, apiKeyCanActivate } = guardWith();
    const ctx = ctxFor({ "x-operator-token": "wrong" });
    await expect(activate(guard, ctx)).rejects.toMatchObject({ status: 401 });
    try {
      await guard.canActivate(ctx);
    } catch (e) {
      const body = (e as { getResponse(): ApiErrorEnvelope }).getResponse();
      expect(body.error.code).toBe("invalid_operator_token");
    }
    expect(apiKeyCanActivate).not.toHaveBeenCalled();
  });

  it("delegates to the ApiKeyGuard when no operator token is present (customer path)", async () => {
    const { guard, apiKeyCanActivate } = guardWith();
    const ctx = ctxFor({ authorization: "Bearer bfft_something" });
    await expect(activate(guard, ctx)).resolves.toBe(true);
    expect(apiKeyCanActivate).toHaveBeenCalledOnce();
  });

  it("401s an operator token when OPERATOR_TOKEN is unset (fails closed, no fall-through)", async () => {
    const { guard, apiKeyCanActivate } = guardWith(undefined);
    const ctx = ctxFor({ "x-operator-token": "anything" });
    await expect(activate(guard, ctx)).rejects.toMatchObject({ status: 401 });
    expect(apiKeyCanActivate).not.toHaveBeenCalled();
  });
});
