import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { OperatorTokenGuard } from "../api-keys/operator-token.guard.js";
import { WebhookTokenGuard } from "../sms/webhook-token.guard.js";

function contextWith(
  headers: Record<string, string | string[] | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function configWith(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (name: string) => values[name],
  } as unknown as ConfigService;
}

describe.each([
  {
    name: "operator",
    env: "OPERATOR_TOKEN",
    header: "x-operator-token",
    create: (config: ConfigService) => new OperatorTokenGuard(config),
  },
  {
    name: "webhook",
    env: "WEBHOOK_INGRESS_TOKEN",
    header: "x-webhook-token",
    create: (config: ConfigService) => new WebhookTokenGuard(config),
  },
])("$name token guard", ({ env, header, create }) => {
  it("accepts the configured token", () => {
    const guard = create(configWith({ [env]: "expected-secret" }));
    expect(
      guard.canActivate(contextWith({ [header]: "expected-secret" })),
    ).toBe(true);
  });

  it.each([
    undefined,
    "",
    "wrong-secret",
  ])("rejects a missing or invalid token", (candidate) => {
    const guard = create(configWith({ [env]: "expected-secret" }));
    expect(() =>
      guard.canActivate(contextWith({ [header]: candidate })),
    ).toThrowError(expect.objectContaining({ status: 401 }));
  });

  it("fails closed when the server secret is not configured", () => {
    const guard = create(configWith({}));
    expect(() =>
      guard.canActivate(contextWith({ [header]: "any-value" })),
    ).toThrowError(expect.objectContaining({ status: 401 }));
  });
});
