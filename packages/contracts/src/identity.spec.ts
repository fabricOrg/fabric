import { describe, expect, it } from "vitest";
import { resolveIdentitySessionResponseSchema } from "./identity.js";

describe("identity session contract", () => {
  it("accepts Postgres UUIDs used by deterministic development tenants", () => {
    expect(
      resolveIdentitySessionResponseSchema.safeParse({
        tenant_id: "00000000-0000-0000-0000-0000000000d1",
        user_id: "10000000-0000-4000-8000-000000000001",
        role: "owner",
        developer_access: false,
        permissions: ["sms:send"],
        session_id: "session_test",
        plan: "free",
      }).success,
    ).toBe(true);
  });

  it("rejects non-UUID tenant identifiers", () => {
    expect(
      resolveIdentitySessionResponseSchema.safeParse({
        tenant_id: "org_external",
        user_id: "10000000-0000-4000-8000-000000000001",
        role: "owner",
        developer_access: false,
        permissions: [],
        session_id: "session_test",
        plan: "free",
      }).success,
    ).toBe(false);
  });

  it("normalizes the legacy developer role during a rolling deployment", () => {
    const parsed = resolveIdentitySessionResponseSchema.parse({
      tenant_id: "00000000-0000-0000-0000-0000000000d1",
      user_id: "10000000-0000-4000-8000-000000000001",
      role: "developer",
      permissions: ["api_keys:read"],
      session_id: "session_legacy",
      plan: "free",
    });
    expect(parsed).toMatchObject({
      role: "member",
      developer_access: true,
    });
  });
});
