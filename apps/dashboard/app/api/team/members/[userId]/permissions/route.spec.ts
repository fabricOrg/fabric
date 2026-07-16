import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSession, refreshSession, setPerms } = vi.hoisted(() => ({
  readSession: vi.fn(),
  refreshSession: vi.fn(),
  setPerms: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  readDashboardSession: readSession,
  refreshDashboardSession: refreshSession,
}));
vi.mock("@/lib/server/origin", () => ({ hasTrustedOrigin: () => true }));
vi.mock("@/lib/server/members-client", () => ({
  setMemberPermissions: setPerms,
}));
vi.mock("@/lib/server/api-client", () => ({
  BffError: class BffError extends Error {
    constructor(
      readonly status: number,
      readonly payload: unknown,
    ) {
      super("BFF error");
    }
  },
}));

import { PUT } from "./route.js";

const params = Promise.resolve({ userId: "u1" });
function req(body: unknown) {
  return new Request("http://localhost/api", {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

describe("member permissions BFF route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPerms.mockResolvedValue({ user_id: "u1", permissions: ["sms:read"] });
  });

  it("allows an admin to set permissions", async () => {
    readSession.mockResolvedValue({ role: "admin", orgId: "org1" });
    const res = await PUT(
      req({ permissions: ["sms:read", "definitions:write"] }),
      {
        params,
      },
    );
    expect(res.status).toBe(200);
    expect(setPerms).toHaveBeenCalledWith("org1", "u1", [
      "sms:read",
      "definitions:write",
    ]);
  });

  it("denies a member", async () => {
    readSession.mockResolvedValue({ role: "member", orgId: "org1" });
    const res = await PUT(req({ permissions: [] }), { params });
    expect(res.status).toBe(403);
    expect(setPerms).not.toHaveBeenCalled();
  });

  it("422s on a permission outside the catalog", async () => {
    readSession.mockResolvedValue({ role: "owner", orgId: "org1" });
    const res = await PUT(req({ permissions: ["not:real"] }), { params });
    expect(res.status).toBe(422);
    expect(setPerms).not.toHaveBeenCalled();
  });
});
