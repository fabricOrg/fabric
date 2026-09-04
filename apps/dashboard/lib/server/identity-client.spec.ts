import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpstreamUnavailableError } from "./api-fetch";
import { resolveUserSessionV2 } from "./identity-client";

const realFetch = globalThis.fetch;

const CLAIMS = {
  externalUserId: "user_01",
  email: "person@example.com",
  name: "Person",
  userUpdatedAt: "2026-08-30T00:00:00.000Z",
  emailVerified: true,
  sessionId: "session_01",
};

function respondWith(status: number): typeof fetch {
  return vi.fn(async () =>
    Response.json(
      { error: { type: "api_error", code: "x", message: "x" } },
      {
        status,
      },
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
 * `refreshAndClassifyUser` reads a null resolution as TERMINAL and deletes the session cookie, and
 * classifies a thrown non-4xx as transient. So the difference between null and throw here is the
 * difference between "every signed-in user is logged out by a 15-second API stall" and "one page
 * load failed". These cases pin that, not the HTTP plumbing.
 */
describe("resolveUserSessionV2 failure classification", () => {
  it("throws on a 504 so a stalled API stays transient", async () => {
    globalThis.fetch = respondWith(504);
    await expect(resolveUserSessionV2(CLAIMS)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    await expect(resolveUserSessionV2(CLAIMS)).rejects.toMatchObject({
      status: 504,
    });
  });

  it("throws on a 500 for the same reason", async () => {
    globalThis.fetch = respondWith(500);
    await expect(resolveUserSessionV2(CLAIMS)).rejects.toMatchObject({
      status: 500,
    });
  });

  it("returns null on a 403 — the identity really was refused", async () => {
    globalThis.fetch = respondWith(403);
    await expect(resolveUserSessionV2(CLAIMS)).resolves.toBeNull();
  });

  it("returns null on a 404", async () => {
    globalThis.fetch = respondWith(404);
    await expect(resolveUserSessionV2(CLAIMS)).resolves.toBeNull();
  });
});
