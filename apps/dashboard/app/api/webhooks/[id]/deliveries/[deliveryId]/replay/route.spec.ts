import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSession, refreshSession, replayDelivery } = vi.hoisted(() => ({
  readSession: vi.fn(),
  refreshSession: vi.fn(),
  replayDelivery: vi.fn(),
}));

vi.mock("@/lib/server/auth", () => ({
  readDashboardSession: readSession,
  refreshDashboardSession: refreshSession,
}));
vi.mock("@/lib/server/origin", () => ({ hasTrustedOrigin: () => true }));
vi.mock("@/lib/server/webhooks-client", () => ({
  replayWebhookDelivery: replayDelivery,
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

const ownerSession = {
  role: "owner",
  permissions: ["api_keys:write"],
};

describe("webhook replay BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    replayDelivery.mockResolvedValue({ id: "delivery-1", state: "pending" });
  });

  it("uses the refresh fallback before an owner replay", async () => {
    readSession.mockResolvedValue(null);
    refreshSession.mockResolvedValue(ownerSession);
    const response = await POST(
      new Request("http://localhost/api", { method: "POST" }),
      {
        params: Promise.resolve({ id: "endpoint-1", deliveryId: "delivery-1" }),
      },
    );
    expect(response.status).toBe(200);
    expect(refreshSession).toHaveBeenCalledOnce();
    expect(replayDelivery).toHaveBeenCalledWith("endpoint-1", "delivery-1");
  });

  it("denies a developer even when the generic integration permission is present", async () => {
    readSession.mockResolvedValue({
      role: "developer",
      permissions: ["api_keys:write"],
    });
    const response = await POST(
      new Request("http://localhost/api", { method: "POST" }),
      {
        params: Promise.resolve({ id: "endpoint-1", deliveryId: "delivery-1" }),
      },
    );
    expect(response.status).toBe(403);
    expect(replayDelivery).not.toHaveBeenCalled();
  });
});
