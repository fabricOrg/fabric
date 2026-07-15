import { describe, expect, it } from "vitest";
import { apiKeyScopeValues, createApiKeyRequest } from "./dev-portal.js";

describe("API key scope contract", () => {
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
        env: "test",
        scopes: ["admin:everything"],
      }).success,
    ).toBe(false);
  });

  it("requires at least one permission", () => {
    expect(
      createApiKeyRequest.safeParse({
        name: "No access",
        env: "test",
        scopes: [],
      }).success,
    ).toBe(false);
  });
});
