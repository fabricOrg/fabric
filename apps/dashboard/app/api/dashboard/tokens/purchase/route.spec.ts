import { beforeEach, describe, expect, it, vi } from "vitest";

const { dashboardApi, readSession, refreshSession } = vi.hoisted(() => ({
  dashboardApi: vi.fn(),
  readSession: vi.fn(),
  refreshSession: vi.fn(),
}));

vi.mock("@/lib/server/api-client", () => ({
  BffError: class BffError extends Error {},
  dashboardApi,
}));
vi.mock("@/lib/server/auth", () => ({
  readDashboardSession: readSession,
  refreshDashboardSession: refreshSession,
}));
vi.mock("@/lib/server/origin", () => ({ hasTrustedOrigin: () => true }));

import { POST } from "./route";

const offerVersionId = "273e8b6a-82e8-46e1-86ab-274e458888de";

function request(body: unknown) {
  return new Request("http://localhost/api/dashboard/tokens/purchase", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("commercial-offer purchase BFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    refreshSession.mockResolvedValue(null);
    dashboardApi.mockResolvedValue({
      authorization_url: "https://checkout.paystack.test/token-ref",
      reference: "token-ref",
      offer_version_id: offerVersionId,
      pack_count: 2,
      quantity: "400",
      amount_minor: "600",
      currency: "GHS",
    });
  });

  it("uses the authenticated owner's email and never accepts one from the browser", async () => {
    readSession.mockResolvedValue({
      role: "owner",
      plan: "growth",
      email: "owner@example.com",
    });
    const response = await POST(
      request({
        offer_version_id: offerVersionId,
        pack_count: 2,
        email: "attacker@example.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(dashboardApi).toHaveBeenCalledWith(
      "/v1/tokens/purchase",
      "wallet:read",
      expect.objectContaining({
        body: JSON.stringify({
          offer_version_id: offerVersionId,
          pack_count: 2,
          email: "owner@example.com",
        }),
      }),
    );
  });

  it("denies non-admin members before reaching checkout", async () => {
    readSession.mockResolvedValue({
      role: "member",
      plan: "growth",
      email: "member@example.com",
    });
    expect(
      (await POST(request({ offer_version_id: offerVersionId, pack_count: 1 })))
        .status,
    ).toBe(403);
    expect(dashboardApi).not.toHaveBeenCalled();
  });

  it("denies sandbox purchases even for an owner", async () => {
    readSession.mockResolvedValue({
      role: "owner",
      plan: "sandbox",
      email: "owner@example.com",
    });
    expect(
      (await POST(request({ offer_version_id: offerVersionId, pack_count: 1 })))
        .status,
    ).toBe(403);
    expect(dashboardApi).not.toHaveBeenCalled();
  });

  it("rejects invalid pack counts at the browser boundary", async () => {
    readSession.mockResolvedValue({
      role: "admin",
      plan: "growth",
      email: "admin@example.com",
    });
    expect(
      (await POST(request({ offer_version_id: offerVersionId, pack_count: 0 })))
        .status,
    ).toBe(422);
    expect(dashboardApi).not.toHaveBeenCalled();
  });
});
