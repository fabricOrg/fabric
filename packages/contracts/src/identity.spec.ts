import { describe, expect, it } from "vitest";
import { resolveUserSessionResponseSchema } from "./identity.js";

const membership = {
  tenant_id: "00000000-0000-0000-0000-0000000000d1",
  workspace_name: "Fabric Testing",
  workspace_slug: "fabric-testing",
  role: "owner",
  developer_access: false,
  permissions: ["sms:send"],
  plan: "free",
};

describe("identity session contract (ADR-0007 resolve-v2)", () => {
  it("accepts Postgres UUIDs used by deterministic development tenants", () => {
    expect(
      resolveUserSessionResponseSchema.safeParse({
        user_id: "10000000-0000-4000-8000-000000000001",
        email: "owner@example.com",
        name: "Owner",
        memberships: [membership],
        session_id: "session_test",
      }).success,
    ).toBe(true);
  });

  it("rejects non-UUID tenant identifiers", () => {
    expect(
      resolveUserSessionResponseSchema.safeParse({
        user_id: "10000000-0000-4000-8000-000000000001",
        email: "owner@example.com",
        name: null,
        memberships: [{ ...membership, tenant_id: "org_external" }],
        session_id: "session_test",
      }).success,
    ).toBe(false);
  });

  it("defaults staff_realm to false when the API omits it", () => {
    // Compatibility direction that matters: a dashboard deployed AHEAD of the API must fall back to
    // today's onboarding behaviour, never infer staff routing from a missing field.
    const parsed = resolveUserSessionResponseSchema.parse({
      user_id: "10000000-0000-4000-8000-000000000001",
      email: "owner@example.com",
      name: null,
      memberships: [],
      session_id: "session_compat",
    });
    expect(parsed.staff_realm).toBe(false);
  });

  it("carries staff_realm through when the API reports an allowlist match", () => {
    const parsed = resolveUserSessionResponseSchema.parse({
      user_id: "10000000-0000-4000-8000-000000000001",
      email: "operator@example.com",
      name: null,
      memberships: [],
      staff_realm: true,
      session_id: "session_staff",
    });
    expect(parsed.staff_realm).toBe(true);
  });

  it("normalizes the legacy developer role on the wire", () => {
    const parsed = resolveUserSessionResponseSchema.parse({
      user_id: "10000000-0000-4000-8000-000000000001",
      email: "dev@example.com",
      name: null,
      memberships: [
        { ...membership, role: "developer", developer_access: true },
      ],
      session_id: "session_legacy",
    });
    expect(parsed.memberships[0]).toMatchObject({
      role: "member",
      developer_access: true,
    });
  });
});
