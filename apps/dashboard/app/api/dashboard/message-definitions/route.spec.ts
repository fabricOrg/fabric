import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSession, refreshSession, listDefs, createDef } = vi.hoisted(() => ({
  readSession: vi.fn(),
  refreshSession: vi.fn(),
  listDefs: vi.fn(),
  createDef: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  readDashboardSession: readSession,
  refreshDashboardSession: refreshSession,
}));
vi.mock("@/lib/server/origin", () => ({ hasTrustedOrigin: () => true }));
vi.mock("@/lib/server/message-definitions-client", () => ({
  listMessageDefinitions: listDefs,
  createMessageDefinition: createDef,
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

import { GET, POST } from "./route.js";

const validBody = {
  key: "order.shipped",
  content: { body: "Hi {{name}}", class: "transactional", locales: {} },
  variable_schema: {
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
  },
  default_locale: "en",
  sender_id: "FABRIC",
};

function req(body?: unknown) {
  return new Request("http://localhost/api/dashboard/message-definitions", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("message-definitions BFF route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listDefs.mockResolvedValue({ definitions: [] });
    createDef.mockResolvedValue({
      definition: { id: "d1" },
      latest_version: null,
      releases: [],
    });
  });

  it("GET lists for any authenticated member", async () => {
    readSession.mockResolvedValue({ role: "member", permissions: [] });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(listDefs).toHaveBeenCalledOnce();
  });

  it("GET 401s without a session", async () => {
    readSession.mockResolvedValue(null);
    refreshSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("POST create allows a user with definitions:write", async () => {
    readSession.mockResolvedValue({
      role: "member",
      permissions: ["definitions:write"],
    });
    const res = await POST(req(validBody));
    expect(res.status).toBe(201);
    expect(createDef).toHaveBeenCalledOnce();
  });

  it("POST create denies a user without definitions:write", async () => {
    readSession.mockResolvedValue({
      role: "member",
      permissions: ["sms:send", "applications:read"],
    });
    const res = await POST(req(validBody));
    expect(res.status).toBe(403);
    expect(createDef).not.toHaveBeenCalled();
  });

  it("POST create 422s on an out-of-subset schema", async () => {
    readSession.mockResolvedValue({
      role: "member",
      permissions: ["definitions:write"],
    });
    const res = await POST(
      req({ ...validBody, variable_schema: { type: "object", $ref: "#/x" } }),
    );
    expect(res.status).toBe(422);
    expect(createDef).not.toHaveBeenCalled();
  });
});
