import { describe, expect, it } from "vitest";
import type { RequestTenant } from "../api-keys/api-key.guard.js";
import { webhookCallerEnvironment } from "./webhook-caller-scope.js";

function tenant(overrides: Partial<RequestTenant>): RequestTenant {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    scopes: ["api_keys:read", "api_keys:write"],
    keyId: "key-hash-prefix",
    applicationId: null,
    environmentId: null,
    isSessionToken: false,
    ...overrides,
  } as RequestTenant;
}

describe("webhookCallerEnvironment", () => {
  it("leaves a BFF tenant token unscoped — the dashboard names its own application", () => {
    expect(
      webhookCallerEnvironment(tenant({ isSessionToken: true })),
    ).toBeUndefined();
  });

  it("confines an sk_* key to the environment it belongs to", () => {
    expect(
      webhookCallerEnvironment(
        tenant({ environmentId: "00000000-0000-4000-8000-0000000000e1" }),
      ),
    ).toBe("00000000-0000-4000-8000-0000000000e1");
  });

  // The regression. `tenant.environmentId ?? undefined` turned the narrowing OFF for this
  // credential, so a legacy key read, disabled and replayed across every environment in its tenant
  // — a sandbox key reaching live endpoints. A null environment means "unscoped is correct" for a
  // session token and "we cannot tell" for a key; only one of those may proceed.
  it("refuses a legacy sk_* key that cannot say which environment it belongs to", () => {
    let thrown: unknown;
    try {
      webhookCallerEnvironment(tenant({}));
    } catch (error) {
      thrown = error;
    }
    expect(thrown, "a legacy key must not be allowed through").toBeDefined();
    // Asserted through the envelope, not error.message: Nest reports "Http Exception" there, so a
    // message assertion would pass against any HttpException and prove nothing about this one.
    const body = (
      thrown as { getResponse?: () => { error?: { code?: string } } }
    ).getResponse?.();
    expect(body?.error?.code).toBe("scoped_api_key_required");
  });
});
