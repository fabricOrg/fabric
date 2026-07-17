import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSession, refreshSession, addVersion } = vi.hoisted(() => ({
  readSession: vi.fn(),
  refreshSession: vi.fn(),
  addVersion: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  readDashboardSession: readSession,
  refreshDashboardSession: refreshSession,
}));
vi.mock("@/lib/server/origin", () => ({ hasTrustedOrigin: () => true }));
vi.mock("@/lib/server/message-definitions-client", () => ({
  addMessageDefinitionVersion: addVersion,
}));
vi.mock("@/lib/server/api-client", () => ({
  BffError: class BffError extends Error {},
}));

import { POST } from "./route.js";

const body = {
  content: { body: "Hi {{name}}", class: "transactional", locales: {} },
  variable_schema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  },
  default_locale: "en",
  sender_id: "FABRIC",
};

function request() {
  return new Request("http://localhost/definitions/id/versions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: "definition-id" }) };

describe("message definition version BFF route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addVersion.mockResolvedValue({ definition: {}, releases: [] });
  });

  it("allows a member with definitions:write to create a version", async () => {
    readSession.mockResolvedValue({ permissions: ["definitions:write"] });
    const response = await POST(request(), context);
    expect(response.status).toBe(201);
    expect(addVersion).toHaveBeenCalledWith("definition-id", body);
  });

  it("keeps the developer read-only without an explicit write grant", async () => {
    readSession.mockResolvedValue({
      developerAccess: true,
      permissions: ["api_keys:read", "request_logs:read"],
    });
    const response = await POST(request(), context);
    expect(response.status).toBe(403);
    expect(addVersion).not.toHaveBeenCalled();
  });

  it("uses refresh fallback before returning an invalid session", async () => {
    readSession.mockResolvedValue(null);
    refreshSession.mockResolvedValue(null);
    expect((await POST(request(), context)).status).toBe(401);
  });
});
