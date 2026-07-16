import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSession, refreshSession, publishDef } = vi.hoisted(() => ({
  readSession: vi.fn(),
  refreshSession: vi.fn(),
  publishDef: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  readDashboardSession: readSession,
  refreshDashboardSession: refreshSession,
}));
vi.mock("@/lib/server/origin", () => ({ hasTrustedOrigin: () => true }));
vi.mock("@/lib/server/message-definitions-client", () => ({
  publishMessageDefinition: publishDef,
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

import { POST } from "./route.js";

const body = {
  environment: "sandbox",
  version_id: "11111111-1111-4111-8111-111111111111",
};

function req() {
  return new Request("http://localhost/api", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ id: "d1" });

describe("message-definition publish BFF route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishDef.mockResolvedValue({
      definition: { id: "d1", status: "active" },
      latest_version: null,
      releases: [],
    });
  });

  it("allows a user with definitions:publish", async () => {
    readSession.mockResolvedValue({
      role: "admin",
      permissions: ["definitions:publish"],
    });
    expect((await POST(req(), { params })).status).toBe(200);
    expect(publishDef).toHaveBeenCalledWith("d1", body);
  });

  it("denies a user with only definitions:write (can draft, not publish)", async () => {
    readSession.mockResolvedValue({
      role: "member",
      permissions: ["definitions:write"],
    });
    expect((await POST(req(), { params })).status).toBe(403);
    expect(publishDef).not.toHaveBeenCalled();
  });

  it("denies a user with no definitions permission", async () => {
    readSession.mockResolvedValue({
      role: "member",
      permissions: ["sms:send"],
    });
    expect((await POST(req(), { params })).status).toBe(403);
    expect(publishDef).not.toHaveBeenCalled();
  });
});
