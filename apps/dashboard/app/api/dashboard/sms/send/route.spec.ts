import { beforeEach, describe, expect, it, vi } from "vitest";

const { dashboardApi } = vi.hoisted(() => ({
  dashboardApi: vi.fn(),
}));

vi.mock("@/lib/server/api-client", () => ({
  BffError: class BffError extends Error {},
  dashboardApi,
}));
vi.mock("@/lib/server/origin", () => ({
  hasTrustedOrigin: () => true,
}));

import { POST } from "./route";

function request(
  body: unknown,
  idempotencyKey: string | null = "send-attempt-1",
) {
  return new Request("http://localhost/api/dashboard/sms/send", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("dashboard SMS send BFF", () => {
  beforeEach(() => {
    dashboardApi.mockReset();
    dashboardApi.mockResolvedValue({
      id: "message-id",
      status: "accepted",
      encoding: "gsm7",
      segments: 1,
      cost: { currency: "GHS", minor: "3" },
      request_id: "req_1",
    });
  });

  it("forwards explicit classification and the idempotency key", async () => {
    const response = await POST(
      request({
        to: "+233201234567",
        senderId: "ACME",
        body: "A real offer. Reply STOP to opt out.",
        class: "promotional",
      }),
    );

    expect(response.status).toBe(200);
    expect(dashboardApi).toHaveBeenCalledWith(
      "/v1/sms/send",
      "sms:send",
      expect.objectContaining({
        headers: { "idempotency-key": "send-attempt-1" },
        body: JSON.stringify({
          to: "+233201234567",
          sender_id: "ACME",
          body: "A real offer. Reply STOP to opt out.",
          currency: "GHS",
          class: "promotional",
        }),
      }),
    );
  });

  it("rejects a missing idempotency key before the API call", async () => {
    const response = await POST(
      request(
        {
          to: "+233201234567",
          senderId: "ACME",
          body: "Receipt",
          class: "transactional",
        },
        null,
      ),
    );
    expect(response.status).toBe(400);
    expect(dashboardApi).not.toHaveBeenCalled();
  });

  it("rejects an invalid message classification", async () => {
    const response = await POST(
      request({
        to: "+233201234567",
        senderId: "ACME",
        body: "Message",
        class: "unknown",
      }),
    );
    expect(response.status).toBe(400);
    expect(dashboardApi).not.toHaveBeenCalled();
  });

  it("rejects a multi-recipient value at the BFF boundary", async () => {
    const response = await POST(
      request({
        to: "+233201234567,+233501234567",
        senderId: "ACME",
        body: "Message",
        class: "transactional",
      }),
    );
    expect(response.status).toBe(400);
    expect(dashboardApi).not.toHaveBeenCalled();
  });
});
