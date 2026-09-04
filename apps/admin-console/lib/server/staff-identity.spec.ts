import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamUnavailableError } from "./api-fetch";
import { resolveStaffSession } from "./staff-identity";

const realFetch = globalThis.fetch;

const CLAIMS = {
  externalUserId: "user_01",
  organizationId: null,
  email: "operator@example.com",
  name: "Operator",
  userUpdatedAt: "2026-08-30T00:00:00.000Z",
  role: null,
  permissions: [],
  sessionId: "session_01",
};

function respondWith(status: number): typeof fetch {
  return vi.fn(async () =>
    Response.json(
      { error: { type: "api_error", code: "x", message: "x" } },
      { status },
    ),
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  process.env.API_BASE_URL = "https://api.example.com";
  process.env.BFF_INTERNAL_TOKEN = "bff-token";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/**
 * `refreshAndClassify` treats a null resolution as TERMINAL and deletes the staff cookie, while a
 * thrown non-4xx is transient. An API stall must not sign every operator out of the console, so the
 * distinction between "could not answer" and "not on the allowlist" is the thing being pinned.
 */
describe("resolveStaffSession failure classification", () => {
  it("throws on a 504 so a stalled API stays transient", async () => {
    globalThis.fetch = respondWith(504);
    await expect(resolveStaffSession(CLAIMS)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
  });

  it("throws on a 500 for the same reason", async () => {
    globalThis.fetch = respondWith(500);
    await expect(resolveStaffSession(CLAIMS)).rejects.toMatchObject({
      status: 500,
    });
  });

  it("returns null on a 403 — not on the staff allowlist", async () => {
    globalThis.fetch = respondWith(403);
    await expect(resolveStaffSession(CLAIMS)).resolves.toBeNull();
  });
});
