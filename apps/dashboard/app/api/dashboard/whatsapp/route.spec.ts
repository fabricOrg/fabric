import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  MockBffError,
  listWhatsappMessages,
  readDashboardSession,
  refreshDashboardSession,
  sendWhatsappMessage,
} = vi.hoisted(() => ({
  MockBffError: class MockBffError extends Error {
    constructor(
      readonly status: number,
      readonly payload: unknown,
    ) {
      super("BFF error");
    }
  },
  listWhatsappMessages: vi.fn(),
  readDashboardSession: vi.fn(),
  refreshDashboardSession: vi.fn(),
  sendWhatsappMessage: vi.fn(),
}));

vi.mock("@/lib/server/api-client", () => ({
  BffError: MockBffError,
}));
vi.mock("@/lib/server/auth", () => ({
  readDashboardSession,
  refreshDashboardSession,
}));
vi.mock("@/lib/server/origin", () => ({
  hasTrustedOrigin: () => true,
}));
vi.mock("@/lib/server/whatsapp-client", () => ({
  listWhatsappMessages,
  sendWhatsappMessage,
}));

import { GET, POST } from "./route";

const session = {
  orgId: "tenant-1",
  plan: "sandbox",
  permissions: ["whatsapp:read", "whatsapp:send"],
};

function sendRequest(idempotencyKey: string | null = "wa-send-1") {
  return new Request("http://localhost/api/dashboard/whatsapp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      to: "+233201234567",
      template_name: "order_update",
      template_language: "en",
      template_category: "utility",
      variables: ["Ada", "ORD-1"],
      currency: "GHS",
    }),
  });
}

describe("dashboard WhatsApp BFF", () => {
  beforeEach(() => {
    readDashboardSession.mockReset();
    refreshDashboardSession.mockReset();
    listWhatsappMessages.mockReset();
    sendWhatsappMessage.mockReset();
    readDashboardSession.mockResolvedValue(session);
    refreshDashboardSession.mockResolvedValue(null);
    listWhatsappMessages.mockResolvedValue({
      messages: [],
      next_cursor: null,
      request_id: "req_1",
    });
    sendWhatsappMessage.mockResolvedValue({
      id: "00000000-0000-4000-8000-000000000001",
      status: "queued",
      to: "+233***67",
      provider: "sandbox-whatsapp",
      template_name: "order_update",
      template_language: "en",
      template_category: "utility",
      cost: { minor: "0", currency: "GHS" },
      created_at: "2026-08-09T00:00:00.000Z",
      error_code: null,
      request_id: "req_2",
    });
  });

  it("lists through the refreshed session and resolves sandbox from the plan", async () => {
    readDashboardSession.mockResolvedValue(null);
    refreshDashboardSession.mockResolvedValue(session);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(listWhatsappMessages).toHaveBeenCalledWith(
      "tenant-1",
      "sandbox",
      {},
    );
  });

  it("passes cursor pagination to the internal API client", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/dashboard/whatsapp?limit=20&cursor=next-page&status=failed",
      ),
    );

    expect(response.status).toBe(200);
    expect(listWhatsappMessages).toHaveBeenCalledWith("tenant-1", "sandbox", {
      limit: "20",
      cursor: "next-page",
      status: "failed",
    });
  });

  it("forwards the idempotency key and parsed payload on send", async () => {
    const response = await POST(sendRequest());

    expect(response.status).toBe(200);
    expect(sendWhatsappMessage).toHaveBeenCalledWith(
      "tenant-1",
      "sandbox",
      {
        to: "+233201234567",
        template_name: "order_update",
        template_language: "en",
        template_category: "utility",
        variables: ["Ada", "ORD-1"],
        currency: "GHS",
      },
      "wa-send-1",
    );
  });

  it("rejects missing read permission before listing", async () => {
    readDashboardSession.mockResolvedValue({
      ...session,
      permissions: ["whatsapp:send"],
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(listWhatsappMessages).not.toHaveBeenCalled();
  });

  it("rejects missing send permission before calling the API", async () => {
    readDashboardSession.mockResolvedValue({
      ...session,
      permissions: ["whatsapp:read"],
    });

    const response = await POST(sendRequest());

    expect(response.status).toBe(403);
    expect(sendWhatsappMessage).not.toHaveBeenCalled();
  });

  it("rejects a missing idempotency key before calling the API", async () => {
    const response = await POST(sendRequest(null));

    expect(response.status).toBe(400);
    expect(sendWhatsappMessage).not.toHaveBeenCalled();
  });
});
