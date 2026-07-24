import { describe, expect, it } from "vitest";
import { apiKeyScopeValues, createApiKeyRequest } from "./dev-portal.js";

describe("API key scope contract", () => {
  it("is the closed catalog enforced by public data-plane controllers", () => {
    expect(apiKeyScopeValues).toEqual([
      "sms:send",
      "sms:read",
      "email:send",
      "email:read",
      "wallet:read",
      "request_logs:read",
      "api_keys:read",
      "api_keys:write",
      "definitions:read",
      "messages:send",
      "messages:read",
    ]);
  });

  it("accepts every permission advertised by the key-creation UI", () => {
    expect(
      createApiKeyRequest.safeParse({
        name: "Production integration",
        env: "live",
        scopes: [...apiKeyScopeValues],
      }).success,
    ).toBe(true);
  });

  it("rejects unknown permissions", () => {
    expect(
      createApiKeyRequest.safeParse({
        name: "Over-privileged integration",
        env: "sandbox",
        scopes: ["admin:everything"],
      }).success,
    ).toBe(false);
  });

  it("requires at least one permission", () => {
    expect(
      createApiKeyRequest.safeParse({
        name: "No access",
        env: "sandbox",
        scopes: [],
      }).success,
    ).toBe(false);
  });
});
