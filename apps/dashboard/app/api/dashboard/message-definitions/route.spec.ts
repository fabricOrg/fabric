import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSession, refreshSession, listDefs, createDef, listApps } =
  vi.hoisted(() => ({
    readSession: vi.fn(),
    refreshSession: vi.fn(),
    listDefs: vi.fn(),
    createDef: vi.fn(),
    listApps: vi.fn(),
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
vi.mock("@/lib/server/applications-client", () => ({
  listApplications: listApps,
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
  channel: "sms",
  application_id: "5f61e20c-b096-44f8-95d8-3ca31b94643e",
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

const validEmailBody = {
  channel: "email",
  application_id: "5f61e20c-b096-44f8-95d8-3ca31b94643e",
  key: "order.shipped",
  // Email content has no sender_id — the sender identity is the (optional) `from` on the content.
  content: {
    subject: "Order {{order.id}} shipped",
    text: "Hi {{name}}, it shipped.",
    locales: {},
  },
  variable_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      order: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    required: ["name", "order"],
  },
  default_locale: "en",
};

function req(body?: unknown) {
  return new Request("http://localhost/api/dashboard/message-definitions", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getReq(applicationId = validBody.application_id) {
  return new Request(
    `http://localhost/api/dashboard/message-definitions?applicationId=${applicationId}`,
  );
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
    listApps.mockResolvedValue({
      applications: [{ id: validBody.application_id }],
    });
  });

  it("GET lists for any authenticated member", async () => {
    readSession.mockResolvedValue({ role: "member", permissions: [] });
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect(listDefs).toHaveBeenCalledOnce();
  });

  it("GET 401s without a session", async () => {
    readSession.mockResolvedValue(null);
    refreshSession.mockResolvedValue(null);
    expect((await GET(getReq())).status).toBe(401);
  });

  it("rejects a forged application before calling the definitions API", async () => {
    readSession.mockResolvedValue({ role: "member", permissions: [] });
    const res = await GET(getReq("42a659ca-b4e9-4279-bb36-ad07f45ab99d"));
    expect(res.status).toBe(403);
    expect(listDefs).not.toHaveBeenCalled();
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

  it("POST create accepts an email definition (no sender_id) through the channel union", async () => {
    readSession.mockResolvedValue({
      role: "member",
      permissions: ["definitions:write"],
    });
    const res = await POST(req(validEmailBody));
    expect(res.status).toBe(201);
    expect(createDef).toHaveBeenCalledOnce();
    expect(createDef.mock.calls[0]?.[0]).toMatchObject({
      channel: "email",
      content: { subject: "Order {{order.id}} shipped" },
    });
  });

  it("POST create 422s on an email definition with no body", async () => {
    readSession.mockResolvedValue({
      role: "member",
      permissions: ["definitions:write"],
    });
    const res = await POST(
      req({ ...validEmailBody, content: { subject: "S", locales: {} } }),
    );
    expect(res.status).toBe(422);
    expect(createDef).not.toHaveBeenCalled();
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
