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

import { handleCallback, type RealmConfig } from "./index.js";

const appSession = {
  userId: "00000000-0000-0000-0000-0000000000a1",
  orgId: "00000000-0000-0000-0000-0000000000d1",
  role: "owner",
  permissions: ["sms:send"],
  sessionId: "session_1",
};

const resolveSession = vi.fn(
  async (): Promise<typeof appSession | null> => appSession,
);
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

// An org-SCOPED WorkOS session (the shape the invite-gate tests need).
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

describe("org-less callback adoption (ADR-0002 self-serve)", () => {
  const orglessSession = {
    authenticated: true,
    accessToken: "jwt",
    sessionId: "session_1",
    organizationId: undefined,
    role: undefined,
    permissions: [],
    user: {
      id: "user_new",
      email: "stranger@example.com",
      name: "Stranger",
      updatedAt: "2026-07-10T10:00:00.000Z",
      emailVerified: true,
    },
  };
  const resolveOrganization = vi.fn(
    async (): Promise<string | null> => "org_new",
  );
  const signupConfig: RealmConfig = { ...config, resolveOrganization };

  beforeEach(() => {
    vi.clearAllMocks();
    sdk.authenticateWithCode.mockResolvedValue({
      sealedSession: "sealed-session",
    });
    sdk.getLogoutUrl.mockResolvedValue("https://auth.example/logout");
    resolveSession.mockResolvedValue(appSession);
    resolveOrganization.mockResolvedValue("org_new");
  });

  it("adopts the resolved org: provision hook → refresh(organizationId) → org session", async () => {
    sdk.authenticateWithSessionCookie
      .mockResolvedValueOnce(orglessSession) // first resolve: org-less → null session
      .mockResolvedValueOnce(orglessSession) // adoptOrganization inspects the org-less session
      .mockResolvedValueOnce(workosSession); // re-resolve on the refreshed org-scoped cookie
    sdk.refresh.mockResolvedValue({
      authenticated: true,
      sealedSession: "org-scoped-session",
    });
    await expect(
      handleCallback(signupConfig, {
        code: "code",
        state: "state",
        expectedState: "state",
      }),
    ).resolves.toEqual({
      session: appSession,
      sealedCookie: "org-scoped-session",
    });
    expect(resolveOrganization).toHaveBeenCalledWith({
      externalUserId: "user_new",
      email: "stranger@example.com",
      name: "Stranger",
      userUpdatedAt: "2026-07-10T10:00:00.000Z",
      emailVerified: true,
    });
    expect(sdk.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "org_new" }),
    );
  });

  it("denies when the hook returns null (no workspace, signup didn't apply)", async () => {
    resolveOrganization.mockResolvedValue(null);
    sdk.authenticateWithSessionCookie.mockResolvedValue(orglessSession);
    await expect(
      handleCallback(signupConfig, {
        code: "code",
        state: "state",
        expectedState: "state",
      }),
    ).resolves.toEqual({ session: null, sealedCookie: "sealed-session" });
    expect(sdk.refresh).not.toHaveBeenCalled();
  });

  it("never adopts for an ORG-SCOPED session our resolver denied (invite gate stays)", async () => {
    // A known org session whose membership is denied must not fall through to provisioning.
    resolveSession.mockResolvedValue(null);
    sdk.authenticateWithSessionCookie.mockResolvedValue(workosSession);
    await expect(
      handleCallback(signupConfig, {
        code: "code",
        state: "state",
        expectedState: "state",
      }),
    ).resolves.toEqual({ session: null, sealedCookie: "sealed-session" });
    expect(resolveOrganization).not.toHaveBeenCalled();
    expect(sdk.refresh).not.toHaveBeenCalled();
  });

  it("realms WITHOUT the hook keep denying org-less sessions (staff unchanged)", async () => {
    sdk.authenticateWithSessionCookie.mockResolvedValue(orglessSession);
    await expect(
      handleCallback(config, {
        code: "code",
        state: "state",
        expectedState: "state",
      }),
    ).resolves.toEqual({ session: null, sealedCookie: "sealed-session" });
    expect(sdk.refresh).not.toHaveBeenCalled();
  });
});
