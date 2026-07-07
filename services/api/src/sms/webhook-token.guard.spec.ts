import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { WebhookTokenGuard } from "./webhook-token.guard.js";

const TOKEN = "ingress-secret-123";

function guard(): WebhookTokenGuard {
  const config = {
    get: (key: string) => (key === "WEBHOOK_INGRESS_TOKEN" ? TOKEN : undefined),
  } as unknown as ConfigService;
  return new WebhookTokenGuard(config);
}

function ctx(request: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("WebhookTokenGuard", () => {
  it("accepts the token via the x-webhook-token header (POST path)", () => {
    expect(
      guard().canActivate(
        ctx({ headers: { "x-webhook-token": TOKEN }, query: {} }),
      ),
    ).toBe(true);
  });

  it("accepts the token via ?token= for header-less GET callbacks (Arkesel DLR)", () => {
    expect(
      guard().canActivate(ctx({ headers: {}, query: { token: TOKEN } })),
    ).toBe(true);
  });

  it("rejects a wrong token in either location", () => {
    expect(() =>
      guard().canActivate(
        ctx({ headers: { "x-webhook-token": "nope" }, query: {} }),
      ),
    ).toThrow();
    expect(() =>
      guard().canActivate(ctx({ headers: {}, query: { token: "nope" } })),
    ).toThrow();
  });

  it("rejects when no token is presented at all", () => {
    expect(() => guard().canActivate(ctx({ headers: {} }))).toThrow();
  });
});
