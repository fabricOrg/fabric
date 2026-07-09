import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  getAuthorizationUrl: vi.fn(),
  authenticateWithCode: vi.fn(),
  authenticateWithSessionCookie: vi.fn(),
  refresh: vi.fn(),
  getLogoutUrl: vi.fn(),
}));

vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    readonly userManagement = {
      getAuthorizationUrl: sdk.getAuthorizationUrl,
      authenticateWithCode: sdk.authenticateWithCode,
      authenticateWithSessionCookie: sdk.authenticateWithSessionCookie,
      loadSealedSession: () => ({
        refresh: sdk.refresh,
        getLogoutUrl: sdk.getLogoutUrl,
      }),
    };
  },
}));

import {
  buildAuthorizationUrl,
  buildLogout,
  handleCallback,
  type RealmConfig,
  readSession,
  refreshSession,
  refreshSessionDetailed,
} from "./index.js";

const appSession = {
  userId: "00000000-0000-0000-0000-0000000000a1",
  orgId: "00000000-0000-0000-0000-0000000000d1",
  role: "owner",
  permissions: ["sms:send"],
  sessionId: "session_1",
};

const resolveSession = vi.fn(async () => appSession);
const config: RealmConfig = {
  realm: "customer",
  apiKey: "sk_test_example",
  clientId: "client_test",
  cookieName: "wos-session",
  cookiePassword: "a-secure-test-password-at-least-32-characters",
  redirectUri: "http://localhost:3100/auth/callback",
  logoutRedirectUri: "http://localhost:3100/login",
  cookieOptions: {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
  },
  resolveSession,
};

const workosSession = {
  authenticated: true,
  accessToken: "jwt",
  authenticationMethod: "Password",
  sessionId: "session_1",
  organizationId: "org_1",
  role: "owner",
  permissions: ["sms:send"],
  user: {
    id: "user_1",
    email: "owner@example.com",
    name: "Owner",
    updatedAt: "2026-07-04T10:00:00.000Z",
  },
};

describe("@app/fe-auth WorkOS flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.getAuthorizationUrl.mockReturnValue("https://auth.example/authorize");
    sdk.authenticateWithCode.mockResolvedValue({
      sealedSession: "sealed-session",
    });
    sdk.authenticateWithSessionCookie.mockResolvedValue(workosSession);
    sdk.refresh.mockResolvedValue({
      authenticated: true,
      sealedSession: "refreshed-session",
    });
    sdk.getLogoutUrl.mockResolvedValue("https://auth.example/logout");
    resolveSession.mockResolvedValue(appSession);
  });

  it("builds a state-bound authorization URL", () => {
    expect(buildAuthorizationUrl(config, { state: "csrf-state" })).toBe(
      "https://auth.example/authorize",
    );
    expect(sdk.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({ state: "csrf-state" }),
    );
  });

  it("returns an empty result on callback state mismatch, without exchanging the code", async () => {
    await expect(
      handleCallback(config, {
        code: "code",
        state: "returned",
        expectedState: "expected",
      }),
    ).resolves.toEqual({ session: null, sealedCookie: null });
    expect(sdk.authenticateWithCode).not.toHaveBeenCalled();
  });

  it("returns the sealed cookie with a null session when authenticated but not authorized", async () => {
    // WorkOS authenticates (sealed session issued) but our authorization denies → session null,
    // sealedCookie present so the caller can end the WorkOS session and let a retry re-prompt.
    sdk.authenticateWithSessionCookie.mockResolvedValueOnce({
      authenticated: false,
      reason: "invalid_session_cookie",
    });
    await expect(
      handleCallback(config, {
        code: "code",
        state: "state",
        expectedState: "state",
      }),
    ).resolves.toEqual({ session: null, sealedCookie: "sealed-session" });
  });

  it("exchanges and resolves a sealed callback session", async () => {
    await expect(
      handleCallback(config, {
        code: "code",
        state: "state",
        expectedState: "state",
      }),
    ).resolves.toEqual({
      session: appSession,
      sealedCookie: "sealed-session",
    });
    expect(resolveSession).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserId: "user_1",
        organizationId: "org_1",
        userUpdatedAt: "2026-07-04T10:00:00.000Z",
      }),
    );
  });

  it("fails closed for an invalid or unauthorized cookie", async () => {
    sdk.authenticateWithSessionCookie.mockResolvedValue({
      authenticated: false,
      reason: "invalid_session_cookie",
    });
    await expect(readSession(config, "invalid")).resolves.toBeNull();
  });

  it("rotates and resolves a refreshed session", async () => {
    await expect(refreshSession(config, "old-session")).resolves.toEqual({
      session: appSession,
      sealedCookie: "refreshed-session",
    });
  });

  it("builds WorkOS logout and always clears the local cookie", async () => {
    await expect(buildLogout(config, "sealed-session")).resolves.toEqual({
      workosLogoutUrl: "https://auth.example/logout",
      clearCookie: "",
    });
  });
});

describe("refreshSessionDetailed (G2 hardening)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdk.authenticateWithSessionCookie.mockResolvedValue(workosSession);
    resolveSession.mockResolvedValue(appSession);
  });

  it("single-flight: concurrent refreshes with one cookie share ONE WorkOS call", async () => {
    // Refresh tokens rotate — a second concurrent call with the same cookie would present a
    // spent token. Both callers must join the same in-flight refresh.
    let release: (v: unknown) => void = () => undefined;
    sdk.refresh.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const cookie = `sf-${Date.now()}`; // unique per run: the flight map is module-level
    const [a, b] = [
      refreshSessionDetailed(config, cookie),
      refreshSessionDetailed(config, cookie),
    ];
    release({ authenticated: true, sealedSession: "rotated-once" });
    const [ra, rb] = await Promise.all([a, b]);
    expect(sdk.refresh).toHaveBeenCalledTimes(1);
    expect(ra).toEqual(rb);
    expect(ra.status).toBe("refreshed");
  });

  it("classifies a WorkOS 4xx (spent/revoked token) as terminal", async () => {
    sdk.refresh.mockRejectedValue(
      Object.assign(new Error("invalid_grant"), { status: 400 }),
    );
    await expect(
      refreshSessionDetailed(config, `t4-${Date.now()}`),
    ).resolves.toEqual({ status: "terminal" });
  });

  it("classifies an unauthenticated refresh response as terminal", async () => {
    sdk.refresh.mockResolvedValue({ authenticated: false });
    await expect(
      refreshSessionDetailed(config, `tf-${Date.now()}`),
    ).resolves.toEqual({ status: "terminal" });
  });

  it("classifies network faults and WorkOS 5xx as transient (keep the cookie)", async () => {
    sdk.refresh.mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      refreshSessionDetailed(config, `tr1-${Date.now()}`),
    ).resolves.toEqual({ status: "transient" });

    sdk.refresh.mockRejectedValue(
      Object.assign(new Error("upstream"), { status: 503 }),
    );
    await expect(
      refreshSessionDetailed(config, `tr2-${Date.now()}`),
    ).resolves.toEqual({ status: "transient" });
  });

  it("legacy refreshSession maps refreshed → pair and any failure → null", async () => {
    sdk.refresh.mockResolvedValue({
      authenticated: true,
      sealedSession: "refreshed-session",
    });
    await expect(refreshSession(config, `lg1-${Date.now()}`)).resolves.toEqual({
      session: appSession,
      sealedCookie: "refreshed-session",
    });

    sdk.refresh.mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      refreshSession(config, `lg2-${Date.now()}`),
    ).resolves.toBeNull();
  });
});
