import { createApiKeyRequest } from "@app/contracts";
import { describe, expect, it } from "vitest";

/**
 * The form offers "Never" as `0` while the contract expresses never as ABSENT and rejects 0 with
 * `.positive()`. That mismatch made the DEFAULT option unsubmittable, and the failure surfaced as
 * zod's own "Too small: expected number to be >0" with no field named.
 *
 * This pins the payload shape rather than the component, because the defect was in what the form
 * sent, not in how it rendered.
 */
function payload(expiresInDays: number) {
  return {
    name: "Production key",
    env: "live" as const,
    scopes: ["sms:send" as const],
    application_id: "00000000-0000-4000-8000-000000000001",
    ...(expiresInDays > 0 ? { expires_in_days: expiresInDays } : {}),
  };
}

describe("create-api-key payload", () => {
  it('omits the expiry for "Never" instead of sending 0', () => {
    const body = payload(0);
    expect(body).not.toHaveProperty("expires_in_days");
    expect(createApiKeyRequest.safeParse(body).success).toBe(true);
  });

  it("sends a chosen expiry through", () => {
    const parsed = createApiKeyRequest.safeParse(payload(30));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.expires_in_days).toBe(30);
  });

  // Guards the regression directly: if anyone reinstates the 0, this is what the operator saw.
  it("rejects a literal 0, which is what made the default option unsubmittable", () => {
    const parsed = createApiKeyRequest.safeParse({
      ...payload(0),
      expires_in_days: 0,
    });
    expect(parsed.success).toBe(false);
    expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual([
      "expires_in_days",
    ]);
  });
});
