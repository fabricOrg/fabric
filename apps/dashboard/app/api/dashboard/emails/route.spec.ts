import { beforeEach, describe, expect, it, vi } from "vitest";

const { listEmails, readDashboardSession, refreshDashboardSession } =
  vi.hoisted(() => ({
    listEmails: vi.fn(),
    readDashboardSession: vi.fn(),
    refreshDashboardSession: vi.fn(),
  }));

vi.mock("@/lib/server/auth", () => ({
  readDashboardSession,
  refreshDashboardSession,
}));
vi.mock("@/lib/server/emails-client", () => ({ listEmails }));

import { GET } from "./route";

describe("dashboard email BFF", () => {
  beforeEach(() => {
    listEmails.mockReset();
    readDashboardSession.mockReset();
    refreshDashboardSession.mockReset();
    readDashboardSession.mockResolvedValue({
      orgId: "tenant-1",
      plan: "sandbox",
      permissions: ["email:read"],
    });
    refreshDashboardSession.mockResolvedValue(null);
    listEmails.mockResolvedValue({ messages: [], next_cursor: null });
  });

  it("passes cursor and status filters to the internal client", async () => {
    const response = await GET(
      new Request(
        "http://localhost/api/dashboard/emails?limit=20&cursor=next-page&status=failed",
      ),
    );

    expect(response.status).toBe(200);
    expect(listEmails).toHaveBeenCalledWith("tenant-1", "sandbox", {
      limit: "20",
      cursor: "next-page",
      status: "failed",
    });
  });

  it("rejects missing read permission before listing", async () => {
    readDashboardSession.mockResolvedValue({
      orgId: "tenant-1",
      plan: "sandbox",
      permissions: [],
    });

    const response = await GET();

    expect(response.status).toBe(403);
    expect(listEmails).not.toHaveBeenCalled();
  });
});
