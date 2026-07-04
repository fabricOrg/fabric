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
  user: { id: "user_1", email: "owner@example.com", name: "Owner" },
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

  it("rejects callback state mismatch before exchanging the code", async () => {
    await expect(
      handleCallback(config, {
        code: "code",
        state: "returned",
        expectedState: "expected",
      }),
    ).rejects.toThrow("Invalid OAuth state");
    expect(sdk.authenticateWithCode).not.toHaveBeenCalled();
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
